# Research: Server Skeleton

No `NEEDS CLARIFICATION` items remained in the Technical Context. The decisions below resolve the open design questions.

## 1. HTTP server

- **Decision**: Use `Bun.serve` directly, bound to `127.0.0.1`.
- **Rationale**: Built in, zero dependencies, supports routing by hand, streaming (needed later for SSE), and static file responses. Loopback-only binding satisfies the local-only constraint.
- **Alternatives**: Hono/Elysia/Express: unnecessary for two route types; adds dependencies the constitution asks us to justify.

## 2. Port selection and fallback

- **Decision**: Try the requested port (flag, else config, else default `4317`). If listening fails with `EADDRINUSE`, retry with port `0` so the OS assigns a free port, and report the actual port from the listener.
- **Rationale**: Asking the OS avoids the check-then-bind race of "probe for a free port, then bind". It also guarantees success on the first fallback attempt (SC-002).
- **Alternatives**: Increment from the requested port until free (predictable but races and can be slow if many are taken); a port-probing library (extra dependency).

## 3. State directory and instance record

- **Decision**: State root is `~/.agent-visualizer/`, overridable with the `AGENT_VISUALIZER_STATE_DIR` environment variable (used by tests). Each target repo has `instances/<repo-key>/server.json`, where `repo-key` is a readable slug of the repo basename plus the first 8 hex chars of a SHA-1 of the absolute real path (e.g. `agent-visualizer-3fa91c2b`).
- **Rationale**: Satisfies "never inside the target repo", gives one record per repo so concurrent instances for different repos don't clash, and keeps the file name `server.json` the spec and the future launcher skill expect. The readable slug helps humans browsing the folder.
- **Alternatives**: A single `server.json` holding all instances (needs locking); XDG directories (more complex, macOS convention differs); records inside `<repo>/.agent-visualizer/` (violates the read-only principle).

## 4. Stale instance detection

- **Decision**: An existing record is *live* only if its PID is running (`process.kill(pid, 0)`) **and** an HTTP request to its recorded port at `/api/health` answers within 500 ms with the same repo path. Anything else is stale and is overwritten. If live, the new process exits with a message containing the existing address.
- **Rationale**: PID alone can match an unrelated process after PID reuse; the health check removes that false positive. A short timeout keeps startup fast.
- **Alternatives**: PID check only (PID reuse risk); lock files with `flock` (not portable across crashes without extra care).

## 5. Clean shutdown

- **Decision**: In the CLI entry, handle `SIGINT` and `SIGTERM` by stopping the server and removing `server.json`, then exiting 0. Also remove it on normal `process.on("exit")` as a best effort. Only remove the record if its PID matches the current process.
- **Rationale**: Covers Ctrl+C and kill. The PID-match guard prevents deleting a newer instance's record.
- **Alternatives**: `SIGKILL` cannot be handled; stale detection (decision 4) covers that case.

## 6. Configuration

- **Decision**: File name `agent-visualizer.config.json`, searched in the target repo root first, then the current working directory; the first found wins (no merging). Precedence: CLI flag > config file > built-in default. v1 schema is `{ "port"?: number }`; unknown keys are ignored so later features can add keys without breaking older files. Invalid JSON or an invalid `port` is a fatal error naming the file.
- **Rationale**: Matches FR-009/FR-010. Ignoring unknown keys keeps forward compatibility.
- **Alternatives**: Merge both files (surprising precedence); strict unknown-key rejection (breaks on version skew).

## 7. Argument parsing

- **Decision**: `node:util` `parseArgs` (available in Bun), strict mode. Accepts one positional `<repo-path>`, `--port <n>` (integer 1-65535; `0` is rejected as a user value), `--help`, and `--version`.
- **Rationale**: No dependency; strict mode rejects unknown flags per the edge cases.
- **Alternatives**: commander/yargs (dependency for four options).

## 8. Repo path validation

- **Decision**: Expand a leading `~`, resolve relative to the current directory, take `fs.realpath`, then require `stat.isDirectory()` and `R_OK` access. Error messages name the offending path and reason (not found, not a directory, permission denied).
- **Rationale**: Gives one canonical absolute path used in the page, health response and `server.json` (FR-003, symlink edge case). No git requirement.

## 9. Dev vs production serving

- **Decision**: `scripts/dev.ts` starts Vite's dev server on a fixed port (5173) and the API server with `AGENT_VISUALIZER_DEV_UI=http://127.0.0.1:5173`; when that variable is set, `routes.ts` proxies every non-`/api/` HTTP request to it. Vite's HMR WebSocket is not proxied: `vite.config.ts` sets `server.hmr` so the browser connects straight to the Vite port, which avoids WebSocket bridging code in the Bun server. In production (variable unset) `routes.ts` serves files from `dist/web` with an `index.html` fallback for unknown non-API paths.
- **Rationale**: Meets FR-016 with one browser-facing origin in both modes, so the UI never needs CORS configuration or mode-specific URLs.
- **Alternatives**: Run Vite as the only dev server and proxy `/api` to Bun (inverts the spec's wording and makes the printed address differ between modes); build the UI on every change (slow feedback).

## 10. Version source

- **Decision**: `version.ts` imports `version` from `package.json` (Bun supports JSON imports). `package.json` starts at `0.1.0`.
- **Rationale**: Single source of truth; matches the spec's assumption.

## 11. Environment

- **Decision**: Require Bun >= 1.2, declared in `package.json` `engines` and documented in the README. Bun is not installed on the development machine today, so installation is a documented prerequisite (quickstart step 0) and the first task checks it.
- **Rationale**: The constitution fixes Bun as the runtime; surfacing the missing install now avoids a blocked implementation session.
