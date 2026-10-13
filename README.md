# Agent Visualizer

Agent Visualizer is a small local web UI that observes the planner/coder agent pair working in one repository. Point it at a repo and it serves a page in your browser. It is **read-only**: it never writes into the repo it observes.

This is the server skeleton (spec `001-server-skeleton`). The server, CLI, health endpoint, discovery record and a placeholder page showing the repo name are in place. The spec board, timeline and adapters come in later specs (see [`docs/master-spec.md`](docs/master-spec.md)).

## Prerequisites

- [Bun](https://bun.sh) >= 1.2 (`bun --version`)

## Install

```sh
bun install
bun run build      # builds the UI into dist/web (needed once before serving in production mode)
```

## Usage

```sh
agent-visualizer <repo-path> [--port <n>]
agent-visualizer --help | --version
```

Without installing anything globally, run it from this checkout:

```sh
bun src/cli/index.ts <repo-path> [--port <n>]
# or, because the file has a `#!/usr/bin/env bun` shebang and is executable:
./src/cli/index.ts <repo-path>
```

`bun link` registers the `agent-visualizer` command from `package.json`'s `bin` entry so you can run it from anywhere.

On a successful start it prints three lines and keeps running until you press Ctrl+C:

```
Agent Visualizer 0.1.0
Observing: /Users/me/Sites/my-app
Listening: http://127.0.0.1:4317
```

Open the `Listening` address in a browser. The server binds to `127.0.0.1` only.

### Flags

| Argument | Description |
|---|---|
| `<repo-path>` | Directory to observe (required except with `--help`/`--version`). Relative, `~`-prefixed and symlinked paths are accepted; the real absolute path is used. |
| `--port <n>` | Preferred port, integer 1-65535. Default `4317`. If the port is taken, a free port is chosen and `Port <requested> is in use; using <actual>.` is printed to stderr. |
| `--help` | Print usage to stdout and exit 0. |
| `--version` | Print the version to stdout and exit 0. |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean shutdown after SIGINT/SIGTERM, or `--help`/`--version` |
| 1 | Runtime/environment failure: repo path not found, not a directory or unreadable; config file unparseable or invalid; state directory not writable; an instance is already running for this repo |
| 2 | Usage error: missing `<repo-path>`, unknown flag, invalid `--port` |

Every non-zero exit prints a message to stderr naming the specific problem. For "already running" it includes the existing address.

### HTTP API

| Request | Response |
|---|---|
| `GET /api/health` | `200` `{ "status": "ok", "repoPath": "...", "repoName": "...", "version": "..." }` |
| other methods on `/api/health` | `405` |
| any other `/api/...` path | `404` `{ "error": "not_found" }` |
| anything else | the built UI from `dist/web` (unknown paths without a file extension fall back to `index.html`); `503` with a hint if the UI is not built |

## Config file

Optional `agent-visualizer.config.json`. The first file found wins (no merging):

1. `<repo-path>/agent-visualizer.config.json`
2. `./agent-visualizer.config.json` in the current working directory

```json
{ "port": 4317 }
```

| Key | Type | Notes |
|---|---|---|
| `port` | integer 1-65535 | Preferred port. |

Unknown keys are ignored. The top level must be a JSON object. Precedence: `--port` flag > config file > built-in default (`4317`). Invalid JSON or values exit with code 1 and a message naming the file.

Note that a config file placed inside the observed repo is something *you* create there; Agent Visualizer only reads it.

## State directory and `server.json`

So other tools can find a running instance without scanning ports, each instance writes a record outside the observed repo:

```
$AGENT_VISUALIZER_STATE_DIR/instances/<repo-key>/server.json
```

The state root defaults to `~/.agent-visualizer`. `<repo-key>` is the lowercase slug of the repo's directory name plus the first 8 hex characters of the SHA-1 of its absolute real path (for example `my-app-b9de9c68`). The directory is created with mode `0700`.

```json
{
  "port": 4318,
  "pid": 48213,
  "repoPath": "/Users/me/Sites/my-app",
  "startedAt": "2026-10-12T14:03:22.114Z",
  "version": "0.1.0"
}
```

- Written atomically after the port is bound; removed on SIGINT, SIGTERM or normal exit, but only if the on-disk `pid` is the current process.
- An instance is **live** if `pid` is running and `GET http://127.0.0.1:<port>/api/health` answers within 500 ms with the same `repoPath`. A record that is not live is **stale**: the next start for that repo replaces it, and a crash (`kill -9`) leaves it behind.
- A second start for a repo with a live record exits 1 and prints the existing address.
- Readers must not delete records they did not create.

## Scripts

| Command | What it does |
|---|---|
| `bun run dev -- <repo-path> [--port <n>]` | Starts Vite (port 5173) and the Bun server together. The Bun server proxies HTTP requests to Vite, so open the address the server prints. Hot reload works: Vite's HMR WebSocket connects directly to port 5173. Ctrl+C stops both. |
| `bun run build` | Builds the UI to `dist/web`. |
| `bun test` | Runs the unit, integration and end-to-end tests (they use temp directories and a temp state dir, never your real `~/.agent-visualizer`). |
| `bun run verify` | Type check (`tsc --noEmit`) and `bun test`. Run this before calling work done. |

## Read-only guarantee

Agent Visualizer only reads the repo it is pointed at. All state it writes (`server.json`) goes to the state directory above, never into the repo. An end-to-end test snapshots the repo directory before start and after shutdown and asserts they are identical.

## Project structure

```
src/cli/index.ts       CLI entry: args, repo resolution, config, instance check, startup, shutdown
src/server/args.ts     CLI argument parsing and usage text
src/server/repo.ts     Repo path resolution and its errors
src/server/config.ts   agent-visualizer.config.json loading
src/server/state.ts    server.json read/write/remove and liveness check
src/server/port.ts     Port fallback
src/server/routes.ts   HTTP handler: health, static files, dev proxy
src/server/start.ts    Bun.serve wrapper (startServer)
src/server/errors.ts   AppError (exit 1) and UsageError (exit 2)
src/web/               React UI (Vite root)
scripts/dev.ts         `bun run dev` launcher
tests/                 bun tests, including spawned-CLI end-to-end tests
specs/                 Spec Kit feature specs, plans, contracts and tasks
docs/                  Master spec, feature seeds, local setup
```

## Contributing

Work is done by two agent sessions: a **planner** (Claude, plan mode) that writes specs, and a **local coder** (Qwen via Ollama through Claude Code) that implements them. They hand off through the spec files in `specs/`. Setup, shell helpers and guardrails are in [`docs/local-setup.md`](docs/local-setup.md); the project principles are in [`.specify/memory/constitution.md`](.specify/memory/constitution.md).

- One feature branch (`NNN-feature-name`) and one pull request per spec. Never commit to `main`.
- Commit one logical unit at a time; every commit subject ends with `[spec-NNN]`.
- Enable the repo's git hooks once per clone: `git config core.hooksPath .githooks` (refuses commits and pushes on `main` and requires the `[spec-NNN]` tag). `main` is also protected on GitHub, so every change goes through a pull request..
- Run `bun run verify` before calling a task done.
