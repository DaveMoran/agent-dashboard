---

description: "Task list for 001-server-skeleton"
---

# Tasks: Server Skeleton

**Input**: Design documents from `/specs/001-server-skeleton/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (cli, http-api, config-file, server-json), quickstart.md

**Tests**: Included. The spec requires them (FR-017). Tests use temp directories and `AGENT_VISUALIZER_STATE_DIR`, never the real `~/.agent-visualizer`.

**Organization**: Grouped by user story. Complete phases in order; within a phase, tasks marked [P] touch different files and can run in parallel.

## Format: `[ID] [P?] [Story] Description`

## Working rules (from the constitution)

- Work only on branch `001-server-skeleton`. Never commit to `main`. Check with `git branch --show-current` before the first change.
- Commit after each task or small group of tasks; every commit message ends with the tag `[spec-001]`.
- Check off each task in this file (`- [x]`) as soon as it is done.
- The target repo is read-only: no code may write into the `<repo-path>` it is pointed at.
- Paths are relative to the repository root `/Users/moda/Sites/agent-visualizer`. All TypeScript is strict mode.

---

## Phase 1: Setup

**Purpose**: Project initialization

- [x] T001 Run `bun --version` and confirm it prints 1.2.0 or higher. If `bun` is not found or older, STOP and ask the human to install it (e.g. `brew install oven-sh/bun/bun`); do not install it yourself.
- [x] T002 Create `package.json`: `"name": "agent-visualizer"`, `"version": "0.1.0"`, `"private": true`, `"type": "module"`, `"engines": { "bun": ">=1.2.0" }`, `"bin": { "agent-visualizer": "./src/cli/index.ts" }`, scripts `"dev": "bun scripts/dev.ts"`, `"build": "vite build"`, `"test": "bun test"`. Add dependencies `react`, `react-dom` and devDependencies `vite`, `@vitejs/plugin-react`, `typescript`, `@types/bun`, `@types/react`, `@types/react-dom` (use `bun add` / `bun add -d` to install).
- [x] T003 [P] Create `tsconfig.json`: `"strict": true`, `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"`, `"types": ["bun"]`, `"noEmit": true`, `"resolveJsonModule": true`, `"skipLibCheck": true`, `"include": ["src", "tests", "scripts", "vite.config.ts"]`.
- [x] T004 [P] Create `.gitignore` containing `node_modules/`, `dist/`, `.DS_Store`, `*.log`.
- [x] T005 Create `vite.config.ts`: use `@vitejs/plugin-react`; `root: "src/web"`; `build: { outDir: "../../dist/web", emptyOutDir: true }`; `server: { port: 5173, strictPort: true, host: "127.0.0.1", hmr: { host: "127.0.0.1", port: 5173 } }`.

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: Shared building blocks every story uses

- [x] T006 [P] Create `src/server/version.ts` exporting `export const version: string` imported from `../../package.json` (`import pkg from "../../package.json"`), and `src/server/constants.ts` exporting `export const DEFAULT_PORT = 4317`, `export const HOST = "127.0.0.1"`, and `export const CONFIG_FILE_NAME = "agent-visualizer.config.json"`.
- [x] T007 [P] Create `src/server/errors.ts`: `export class AppError extends Error { exitCode = 1 }` and `export class UsageError extends AppError { exitCode = 2 }`. All later error classes extend one of these so the CLI can map them to exit codes (1 runtime, 2 usage).
- [x] T008 Create `src/server/args.ts` exporting `parseCliArgs(argv: string[]): CliOptions` and `usageText: string`, using `parseArgs` from `node:util` in strict mode. `CliOptions = { repoPath: string | undefined; port: number | undefined; help: boolean; version: boolean }` per `data-model.md`. Rules: `--port` must be an integer 1-65535 (reject non-numeric, decimals, 0, negatives, >65535 by throwing `UsageError` naming the bad value); unknown flags throw `UsageError`; missing `<repo-path>` throws `UsageError` unless `--help` or `--version` is set; more than one positional throws `UsageError`. Usage text follows `contracts/cli.md`.
- [x] T009 Create `tests/args.test.ts` covering: valid path only; path plus `--port 4400`; `--help`; `--version`; missing path; `--port abc`; `--port 0`; `--port 70000`; `--port 12.5`; unknown flag; two positionals.

**Checkpoint**: `bun test tests/args.test.ts` passes.

---

## Phase 3: User Story 1 - Launch the visualizer against a repo (Priority: P1) 🎯 MVP

**Goal**: `agent-visualizer <repo-path>` starts a server; page shows the repo name; `/api/health` works; bad paths fail clearly.

**Independent Test**: Quickstart section 2.

- [ ] T010 [US1] Create `src/server/repo.ts` exporting `resolveRepoPath(input: string): Promise<RepoTarget>` where `RepoTarget = { path: string; name: string }`. Steps: expand a leading `~` to `os.homedir()`; resolve relative to `process.cwd()`; `fs.realpath`; require `stat.isDirectory()`; require `fs.access(path, fs.constants.R_OK)`. Throw `RepoNotFoundError`, `RepoNotDirectoryError`, `RepoNotReadableError` (each extends `AppError`, message names the offending path and the reason). `name` is `path.basename` of the resolved path. No trailing slash on `path`.
- [ ] T011 [US1] Create `tests/repo.test.ts` using temp dirs (`fs.mkdtemp` under `os.tmpdir()`): existing dir; relative path; trailing slash; symlink to a dir resolves to the real path; missing path; path that is a file; unreadable dir (chmod 000, restore in `finally`; skip if running as root).
- [ ] T012 [US1] Create `src/server/routes.ts` exporting `createHandler(opts: { repo: RepoTarget; version: string; webRoot: string; devUi?: string }): (req: Request) => Promise<Response>`. Behavior per `contracts/http-api.md`: `GET /api/health` returns JSON `{ status: "ok", repoPath, repoName, version }`; other methods on it return 405; any other `/api/` path returns 404 `{ "error": "not_found" }`; other paths are served from `webRoot` (guard against `..` path traversal: resolved file must stay inside `webRoot`), unknown paths with no file extension fall back to `webRoot/index.html`; if `webRoot/index.html` does not exist return 503 with plain text "UI not built. Run `bun run build`." Leave `devUi` unused for now (US5).
- [ ] T013 [US1] Create `src/server/start.ts` exporting `startServer(opts: { repo: RepoTarget; port: number; webRoot?: string; devUi?: string }): Promise<{ port: number; url: string; stop: () => Promise<void> }>`. Use `Bun.serve({ hostname: HOST, port, fetch: createHandler(...) })`. `webRoot` defaults to `<project root>/dist/web` (derive from `import.meta.dir`). `url` is `http://127.0.0.1:<port>` using the port the server actually bound (`server.port`). `stop` calls `server.stop(true)`.
- [ ] T014 [P] [US1] Create `src/web/index.html` (root `<div id="root">`, module script `/main.tsx`, title "Agent Visualizer") and `src/web/main.tsx` (render `<App />` with `createRoot`).
- [ ] T015 [P] [US1] Create `src/web/App.tsx`: on mount `fetch("/api/health")`; show "Loading…" while pending; on success render `repoName` as an `<h1>` and `repoPath` as secondary text; on failure render an error message (never a blank page).
- [ ] T016 [US1] Create `src/cli/index.ts` with first line `#!/usr/bin/env bun` (run `chmod +x`). Flow: `parseCliArgs(process.argv.slice(2))`; `--help` prints usage and exits 0; `--version` prints the version and exits 0; `resolveRepoPath`; `startServer` with `DEFAULT_PORT` or the `--port` value; print the three lines from `contracts/cli.md` ("Agent Visualizer <version>", "Observing: <path>", "Listening: <url>"). Wrap in try/catch: print `AppError` messages to stderr (plus the usage text for `UsageError`) and exit with `error.exitCode`; unexpected errors print the stack and exit 1.
- [ ] T017 [US1] Create `tests/server.test.ts`: start `startServer` on port 0 with a temp repo and a temp `webRoot` containing `index.html`; assert `/api/health` JSON fields, POST returns 405, `/api/nope` returns 404 with `{error:"not_found"}`, `/` returns the index HTML, `/some/route` falls back to index, `/../secret` does not escape `webRoot`, and with an empty `webRoot` `/` returns 503. Always `await stop()`.
- [ ] T018 [US1] Create `tests/cli.e2e.test.ts` using `Bun.spawn(["bun", "src/cli/index.ts", ...])`: no args exits 2 with usage on stderr; `/does/not/exist` exits 1 mentioning the path; a file path exits 1 mentioning "not a directory"; `--port abc` exits 2; `--help` exits 0; `--version` exits 0 and prints `0.1.0`; a successful start with a temp repo prints the three startup lines (read stdout until "Listening:", then kill the process).

**Checkpoint**: `bun test` passes; `bun run build && bun src/cli/index.ts /tmp` serves the page showing the repo name.

---

## Phase 4: User Story 2 - Port flag and fallback (Priority: P2)

**Goal**: Honor `--port`; fall back to a free port when taken and say so.

**Independent Test**: Quickstart section 3 (first and third commands).

- [ ] T019 [US2] Create `src/server/port.ts` exporting `listenWithFallback<T>(requestedPort: number, listen: (port: number) => T): { server: T; fellBack: boolean }`. Call `listen(requestedPort)`; if it throws an error whose `code === "EADDRINUSE"` (also accept a message containing "EADDRINUSE" or "in use"), call `listen(0)` so the OS picks a free port and return `fellBack: true`. Rethrow any other error.
- [ ] T020 [US2] Create `tests/port.test.ts`: occupy a port with `Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") })`, call `listenWithFallback` with that port, assert `fellBack === true` and the new server's port differs; with a free port assert `fellBack === false` and the port matches; non-EADDRINUSE errors are rethrown. Stop all servers in `finally`.
- [ ] T021 [US2] Update `src/server/start.ts` to use `listenWithFallback` around `Bun.serve`, and extend its return value with `requestedPort: number` and `fellBack: boolean`.
- [ ] T022 [US2] Update `src/cli/index.ts`: when `fellBack` is true, print `Port <requested> is in use; using <actual>.` to stderr before the three startup lines.
- [ ] T023 [US2] Extend `tests/cli.e2e.test.ts`: occupy a port, start the CLI with `--port <that port>`, assert stderr contains the fallback message and "Listening" shows a different port; start with a free `--port` and assert the exact port is used.

**Checkpoint**: `bun test` passes.

---

## Phase 5: User Story 3 - Discovery record (`server.json`) (Priority: P2)

**Goal**: Running instance is discoverable; record cleaned up on shutdown; stale records replaced; duplicates refused.

**Independent Test**: Quickstart section 4.

- [ ] T024 [US3] Create `src/server/state.ts` per `data-model.md` and `contracts/server-json.md`. Export: `stateRoot()` (`process.env.AGENT_VISUALIZER_STATE_DIR` or `~/.agent-visualizer`); `repoKey(repoPath)` = slug of the repo basename (lowercase, non `[a-z0-9]` runs replaced by `-`) + `-` + first 8 hex chars of `sha1(repoPath)` (use `node:crypto`); `instancePath(repoPath)` = `<stateRoot>/instances/<repoKey>/server.json`; `writeInstance(record)` creating the directory with mode `0o700` and writing atomically (write a temp file in the same directory, then `rename`); `readInstance(repoPath)` returning `null` if missing or invalid JSON; `removeInstance(repoPath, pid)` deleting only if the on-disk `pid` equals `pid`; `isLive(record)` = `process.kill(record.pid, 0)` succeeds AND `fetch("http://127.0.0.1:<port>/api/health", { signal: AbortSignal.timeout(500) })` returns JSON whose `repoPath` equals `record.repoPath` (any error means not live). `InstanceRecord = { port: number; pid: number; repoPath: string; startedAt: string; version: string }`. Wrap directory/write failures in `StateDirError extends AppError` naming the directory.
- [ ] T025 [US3] Create `tests/state.test.ts` with `AGENT_VISUALIZER_STATE_DIR` set to a temp dir: write then read round-trip; file lives under `instances/<key>/server.json`; different repos get different keys; `removeInstance` with a non-matching pid leaves the file; matching pid deletes it; corrupt JSON reads as `null`; `isLive` is false for a dead pid (e.g. a just-exited child process) and true for a live `startServer` instance; unwritable state dir throws `StateDirError`.
- [ ] T026 [US3] Add `InstanceRunningError extends AppError` in `src/server/state.ts` with message `Agent Visualizer is already running for <repoPath> at http://127.0.0.1:<port>`.
- [ ] T027 [US3] Update `src/cli/index.ts`: before starting, `readInstance`; if it exists and `isLive` throw `InstanceRunningError`; otherwise (stale) continue and it will be overwritten. After the server is listening, `writeInstance` with the actual port, `process.pid`, the resolved repo path, `new Date().toISOString()` and the version. Register `SIGINT` and `SIGTERM` handlers that `await stop()`, call `removeInstance(repoPath, process.pid)`, then `process.exit(0)`; also remove the record in `process.on("exit")` (synchronous best effort, same pid guard).
- [ ] T028 [US3] Extend `tests/cli.e2e.test.ts` (set `AGENT_VISUALIZER_STATE_DIR` to a temp dir in the spawned env): after start, `server.json` exists with matching `port`, `pid`, `repoPath`, `startedAt`, `version`; send `SIGINT` and assert the file is removed and exit code is 0; a second start for the same repo exits 1 with the existing address while the first record is untouched; a pre-written record with a dead pid is replaced on start; a snapshot of the temp repo's directory listing is identical before start and after shutdown (read-only guarantee, FR-014).

**Checkpoint**: `bun test` passes.

---

## Phase 6: User Story 4 - Config file (Priority: P3)

**Goal**: Optional `agent-visualizer.config.json` with flag > file > default precedence.

**Independent Test**: Quickstart section 5.

- [ ] T029 [US4] Create `src/server/config.ts` exporting `loadConfig(repoPath: string, cwd?: string): Promise<Config>` with `Config = { port: number | undefined; source: string | undefined }`. Search `<repoPath>/agent-visualizer.config.json` first, then `<cwd>/agent-visualizer.config.json` (`cwd` defaults to `process.cwd()`); the first file found wins, no merging; none found returns `{ port: undefined, source: undefined }` silently. The top level must be a JSON object (else `ConfigValueError`); `port`, if present, must be an integer 1-65535; unknown keys are ignored. Throw `ConfigParseError` (message `Invalid JSON in <file>: <parser message>`) and `ConfigValueError` (message `Invalid config in <file>: <reason>`), both extending `AppError`.
- [ ] T030 [US4] Create `tests/config.test.ts` using temp dirs: no file; file in repo only; file in cwd only; both present (repo wins); invalid JSON; array top level; `port: "80"`; `port: 0`; `port: 70000`; unknown key ignored.
- [ ] T031 [US4] Update `src/cli/index.ts`: call `loadConfig(repo.path)` after resolving the repo; effective port = `--port` value ?? `config.port` ?? `DEFAULT_PORT`.
- [ ] T032 [US4] Extend `tests/cli.e2e.test.ts`: config with `{"port": <free port>}` is used; `--port` overrides it; malformed config exits 1 with the file path in stderr; config absent uses the default behavior.

**Checkpoint**: `bun test` passes.

---

## Phase 7: User Story 5 - Develop and build (Priority: P3)

**Goal**: `bun run dev` serves the UI through the Bun server with live reload; `bun run build` + production serving work.

**Independent Test**: Quickstart sections 1 and 6.

- [ ] T033 [US5] Update `src/server/routes.ts` to implement `devUi`: when set, every non-`/api/` request is proxied to `devUi` by `fetch(new URL(url.pathname + url.search, devUi), { method, headers, body })` and the upstream response (status, headers, body) is returned; on connection failure return 502 with plain text "Vite dev server unreachable at <devUi>". HTTP only; the HMR WebSocket is not proxied (see T005).
- [ ] T034 [US5] Update `src/cli/index.ts` to pass `devUi: process.env.AGENT_VISUALIZER_DEV_UI` to `startServer`.
- [ ] T035 [US5] Create `scripts/dev.ts`: forward all CLI args after `bun run dev --` unchanged; spawn Vite (`Bun.spawn(["bunx", "vite"], { stdout: "inherit", stderr: "inherit" })`, config is found automatically at the repo root); poll `http://127.0.0.1:5173` until it answers (max 15 s, else exit 1 with a message); then spawn `bun src/cli/index.ts <args>` with `AGENT_VISUALIZER_DEV_UI=http://127.0.0.1:5173` in the env and inherited stdio; on `SIGINT`/`SIGTERM` or when either child exits, kill the other child and exit with the server's exit code.
- [ ] T036 [US5] Extend `tests/server.test.ts`: start a stub upstream with `Bun.serve`, start `startServer` with `devUi` pointing at it, assert `/` and `/foo.js` are served from the upstream while `/api/health` still comes from the server; with `devUi` pointing at a closed port assert 502.
- [ ] T037 [US5] Run `bun run build` and confirm `dist/web/index.html` exists, then start the CLI against a temp directory and confirm the page is served from a single process. Then run `bun run dev -- <temp dir>`, confirm the printed address loads the page, edit `src/web/App.tsx` (e.g. change a heading), confirm the browser updates without restarting, and revert the edit. Record anything unexpected in the PR description.

**Checkpoint**: All five stories work; `bun test` passes.

---

## Phase 8: Polish, Documentation and PR

**Purpose**: Required by the constitution; the feature is not done until these are checked off.

- [ ] T038 Rewrite `README.md` (create if absent) covering: what Agent Visualizer is; prerequisites (Bun >= 1.2); install (`bun install`); usage `agent-visualizer <repo-path> [--port <n>]` (and `bun src/cli/index.ts` / `bun link`); the flags and exit codes from `contracts/cli.md`; the config file (location, schema, precedence); the state directory and the `server.json` format (for other tools); the three scripts `bun run dev`, `bun run build`, `bun test`; the read-only guarantee; and a project-structure overview. Include a "Contributing" section: the two-session workflow (planner and local coder), one feature branch and PR per spec, `git config core.hooksPath .githooks` to enable the repo's git hooks, `bun run verify`, and a link to `docs/local-setup.md` and `.specify/memory/constitution.md`.
- [ ] T039 Update `docs/master-spec.md`: add rows to the Decisions table for default port 4317, state directory `~/.agent-visualizer/instances/<repo-key>/server.json`, loopback-only binding, and dev mode (Bun server proxies HTTP to Vite, HMR direct); mention the double-agent launcher will read `server.json`. Keep the rest unchanged.
- [ ] T040 Walk through every scenario in `specs/001-server-skeleton/quickstart.md`; fix any code or any doc/command in the quickstart that does not match actual behavior.
- [ ] T041 Run `bun run verify` (type check + tests) and `bun run build`; both must pass with no errors. Fix failures before continuing.
- [ ] T042 Confirm `git status` shows no stray files (no `node_modules`, `dist`, temp files), check off every task above, and commit remaining work with a message ending in `[spec-001]`.
- [ ] T043 Push `001-server-skeleton` and open a pull request to `main` with `gh pr create`. PR description: summary of the spec, link to `specs/001-server-skeleton/`, list of documentation updated (T038, T039), and results of T037/T040. If no git remote is configured, STOP and tell the human instead of creating one.

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3 (US1) are strictly sequential; US1 is the MVP.
- US2, US3, US4 and US5 each depend on US1 (they modify `start.ts` / `cli/index.ts` / `routes.ts`); they also share `src/cli/index.ts` and `tests/cli.e2e.test.ts`, so implement them **in order** (US2 → US3 → US4 → US5) rather than in parallel.
- US3 needs `startServer` and `/api/health` from US1 (for the liveness check); US4 and US2 are otherwise independent of each other.
- Phase 8 runs last. T038 and T039 can be written in parallel.

### Parallel opportunities

- Setup: T003 and T004.
- Foundational: T006 and T007.
- US1: T014 and T015 (web files), and T010/T012 are independent of the web files.
- Phase 8: T038 and T039.

## Implementation Strategy

1. Finish Phases 1-3 and stop to validate (MVP: the server runs and shows the repo name).
2. Add US2 → US3 → US4 → US5 in order, running `bun test` after each phase.
3. Finish with Phase 8; never skip the documentation tasks.
