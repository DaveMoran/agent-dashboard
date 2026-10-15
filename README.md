# Agent Visualizer

Agent Visualizer is a small local web UI that observes Claude Code agents at work. Point it at a repo and it serves a page in your browser. It is **read-only**: it never writes into the repo it observes. It is heading toward MAGI: a desktop view of up to three projects at once, one per "brain" (MELCHIOR, BALTHASAR, CASPER), each showing whether its agents are ready, working or waiting for you (see [`docs/master-spec.md`](docs/master-spec.md)).

This is the server skeleton (spec `001-server-skeleton`) plus the shared spec model, adapter contract and spec watcher (spec `002-common-model-adapter-interface`). The server, CLI, health endpoint, discovery record and a placeholder page showing the repo name are in place, and the core can validate adapter output, select an adapter, scan and watch spec files. The Spec Kit adapter (spec `003-speckit-adapter`) now reads specs from every worktree of a repo; the spec board and the timeline come in later specs (see [`docs/master-spec.md`](docs/master-spec.md)).

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
| `GET /api/sessions` | `200` `SessionsResponse`: the projects with at least one main-agent session (see below) |
| other methods on `/api/sessions` | `405` with `Allow: GET` |
| any other `/api/...` path | `404` `{ "error": "not_found" }` |
| anything else | the built UI from `dist/web` (unknown paths without a file extension fall back to `index.html`); `503` with a hint if the UI is not built |

#### `GET /api/sessions`

Returns the Claude Code projects found in the transcripts and their main-agent sessions. Types are in `src/contract/sessions.ts`. Projects and sessions are sorted by `lastActivity`, newest first (ties by id). Without a transcript source the body is `{ "projects": [] }`.

```json
{
  "projects": [
    {
      "id": "/Users/me/Sites/agent-visualizer/.git",
      "name": "agent-visualizer",
      "lastActivity": "2026-10-15T10:03:05.100Z",
      "sessions": [
        {
          "sessionId": "7ec15f17-34b7-46b3-8616-2a43c9b59191",
          "model": "claude-opus-5-5",
          "cwd": "/Users/me/Sites/agent-visualizer",
          "state": "standby",
          "runningSubagents": 0,
          "stateSince": "2026-10-15T10:03:05.000Z",
          "lastActivity": "2026-10-15T10:03:05.100Z"
        }
      ]
    }
  ]
}
```

- A **project** is the git common dir of a session's `cwd`, so all worktrees of a repo are one project; outside git it is the `cwd` itself.
- Only **main-agent** sessions are listed: those whose model matches `mainAgentModel` (see Config file).
- `state` is `"working"` or `"standby"`. A session is `working` after a prompt, tool call or tool result, until a final reply, a turn-end marker or an interrupt ends the turn. It is also `working` while any subagent is running, even if its own turn has ended.
- `runningSubagents` counts the session's subagents that are still running, background ones included. A subagent counts as running while its own transcript says it is working and the main session has not recorded a completion notice for it.
- `stateSince` is when the state last changed (`null` if unknown). `lastActivity` is the newest timestamp over the session and its subagent transcripts.
- Known limitation: a subagent that dies with neither a final reply nor a completion notice keeps its session `working` until the idle timeout planned for spec 006.

## Config file

Optional `agent-visualizer.config.json`. The first file found wins (no merging):

1. `<repo-path>/agent-visualizer.config.json`
2. `./agent-visualizer.config.json` in the current working directory

```json
{ "port": 4317, "adapter": "some-adapter-name", "mainAgentModel": "^claude-(opus|fable)", "transcriptsDir": "~/.claude/projects" }
```

| Key | Type | Notes |
|---|---|---|
| `port` | integer 1-65535 | Preferred port. |
| `adapter` | non-empty string | Forces the named spec adapter instead of auto-detection. A value that is not a non-empty string, or a name that is not registered, exits 1 with a message (see [`docs/adapters.md`](docs/adapters.md)). |
| `mainAgentModel` | non-empty string (regex) | Sessions whose model matches are main agents. Default `^claude-(opus|fable)`. A string that is not a valid regex does not stop startup: a warning naming the setting is printed to stderr and the default is used. |
| `transcriptsDir` | non-empty string | Where Claude Code transcripts are read from. Default `~/.claude/projects`. `~/` expands to your home directory; a relative path is resolved against the directory of the config file. |

The environment variable `AGENT_VISUALIZER_TRANSCRIPTS_DIR` overrides `transcriptsDir`. The CLI prints the directory it reads as `Transcripts: <path>` on startup. The transcripts are polled every 500 ms; a missing directory is not an error and shows no sessions until it appears.

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

## Spec adapters

Spec data reaches the app through adapters, one per spec framework, all mapping to one shared model. The core validates adapter output, reports problems as issues instead of failing, and watches the spec files for changes (read-only). The `speckit` adapter reads Spec Kit features from `specs/NNN-name/`. How to write and register one is in [`docs/adapters.md`](docs/adapters.md).

## Scripts

| Command | What it does |
|---|---|
| `bun run dev -- <repo-path> [--port <n>]` | Starts Vite (port 5173) and the Bun server together. The Bun server proxies HTTP requests to Vite, so open the address the server prints. Hot reload works: Vite's HMR WebSocket connects directly to port 5173. Ctrl+C stops both. |
| `bun run build` | Builds the UI to `dist/web`. |
| `bun test` | Runs the unit, integration and end-to-end tests (they use temp directories and a temp state dir, never your real `~/.agent-visualizer`). |
| `bun run live-check [repo-path]` | Scans a repo (default: this one) with the Spec Kit adapter and prints its roots, specs and issues. Read-only; not part of `bun test`. |
| `bun run verify` | Type check (`tsc --noEmit`) and `bun test`. Run this before calling work done. |

## Read-only guarantee

Agent Visualizer only reads the repo it is pointed at. All state it writes (`server.json`) goes to the state directory above, never into the repo. Claude Code transcripts under `transcriptsDir` are only read, never written. An end-to-end test snapshots the repo directory before start and after shutdown and asserts they are identical.

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
src/contract/          Shared types between server and UI (`sessions.ts`); imports nothing from the server
src/agents/            Agent sources: the source interface, main-agent rule, and `transcripts/` (Claude Code JSONL tailing, session state, subagents)
src/core/              Shared spec model, adapter contract, validation, registry, scan and watcher (no framework names)
src/git/               Read-only git access (runGit, worktree roots)
src/adapters/          Registered spec adapters (`index.ts`)
src/adapters/speckit/  The Spec Kit adapter
src/web/               React UI (Vite root)
fixtures/              Stub adapter, `fixtures/speckit/` and other fixture repos used by tests
scripts/dev.ts         `bun run dev` launcher
tests/                 bun tests, including spawned-CLI end-to-end tests
specs/                 Spec Kit feature specs, plans, contracts and tasks
docs/                  Master spec, feature seeds, local setup
```

## Contributing

Work is done by a **planner** (Claude Opus, plan mode) that writes specs and a **coder** (Claude Sonnet) that implements them. Specs 001–003 used two separate sessions; from 004 on the coder runs as Sonnet subagents of the planner's session. Specs 001–003 also tried a local model (Qwen3-Coder via Ollama through Claude Code), which works for small, explicit tasks, with the setup and its limits described in [`docs/local-setup.md`](docs/local-setup.md). They hand off through the spec files in `specs/`. Setup, shell helpers and guardrails are in [`docs/local-setup.md`](docs/local-setup.md); the project principles are in [`.specify/memory/constitution.md`](.specify/memory/constitution.md).

- One feature branch (`NNN-feature-name`) and one pull request per spec. Never commit to `main`.
- Commit one logical unit at a time; every commit subject ends with `[spec-NNN]`.
- Enable the repo's git hooks once per clone: `git config core.hooksPath .githooks` (refuses commits and pushes on `main` and requires the `[spec-NNN]` tag). `main` is also protected on GitHub, so every change goes through a pull request.
- Run `bun run verify` before calling a task done.
