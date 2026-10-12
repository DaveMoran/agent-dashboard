# Implementation Plan: Server Skeleton

**Branch**: `001-server-skeleton` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-server-skeleton/spec.md`

## Summary

Create the runnable skeleton: a Bun + TypeScript CLI (`agent-visualizer <repo-path>`) that validates the repo path, resolves configuration (flags > config file > defaults), starts a local HTTP server on a free port, serves `/api/health` plus a React/Vite placeholder UI from the same process, and publishes/cleans up a `server.json` instance record in a per-user state directory. Development mode proxies non-API requests to the Vite dev server; production mode serves the built static UI. No git, spec, or transcript logic yet.

## Technical Context

**Language/Version**: TypeScript (strict), Bun >= 1.2 (see Environment note)

**Primary Dependencies**: runtime: `react`, `react-dom`; dev: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/bun`, `@types/react`, `@types/react-dom`. No server framework (use `Bun.serve`), no arg-parsing library (use `node:util` `parseArgs`), no validation library (hand-written config validation).

**Storage**: Files only: `server.json` under the per-user state directory; nothing in the target repo.

**Testing**: `bun test` (built-in runner). Unit tests for pure modules; integration tests start the server in-process on port 0 with a temp state dir; one end-to-end test spawns the CLI as a subprocess to verify signal-driven cleanup.

**Target Platform**: Local developer machine; server bound to `127.0.0.1` only.

**Project Type**: single project (CLI + local web server + bundled SPA)

**Performance Goals**: Command to page-visible in under 5 seconds (SC-001).

**Constraints**: Read-only toward the target repo (FR-014); no network calls beyond localhost; no telemetry.

**Scale/Scope**: One target repo per process; a handful of source files (~10) and ~6 test files.

**Environment note**: Bun is **not currently installed** on the development machine (checked 2026-10-12; Node 26 and npm/pnpm are present). Installing Bun is a prerequisite documented in `quickstart.md` and the README; the first implementation task verifies `bun --version`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Feature branches and PRs only | PASS | Work is on `001-server-skeleton`; tasks end with opening a PR, never committing to `main`. |
| II. Documentation ships with code | PASS | README rewrite and `docs/` update are explicit tasks (FR-018); `tasks.md` must include a documentation task. |
| III. Read-only observer | PASS | Only writes are to the tool's own state dir; a test asserts the target repo is unchanged (FR-014). |
| IV. Framework-agnostic via adapters | PASS (n/a) | No framework-specific logic in this feature. |
| V. Test-backed and fixture-driven | PASS | Tests use temp dirs and an overridable state directory, never live machine state. |
| VI. Small, explicit tasks | PASS | Module layout below is intentionally fine-grained so tasks can name single files. |
| Tech constraints (TS strict, Bun, React+Vite, local-only) | PASS | Matches Technical Context; loopback-only binding. |

**Post-design re-check (after Phase 1)**: PASS. No new dependencies beyond those listed; no violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-server-skeleton/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── cli.md           # Command-line interface contract
│   ├── http-api.md      # /api/health contract and static/proxy routing
│   ├── config-file.md   # agent-visualizer.config.json contract
│   └── server-json.md   # Instance record contract
└── tasks.md             # Phase 2 output (/speckit-tasks - NOT created here)
```

### Source Code (repository root)

```text
package.json                    # scripts: dev, build, test; bin: agent-visualizer
tsconfig.json                   # strict; covers src/ and tests/
vite.config.ts                  # root: src/web; build.outDir: dist/web; dev port fixed
README.md                       # rewritten per FR-018

src/
├── cli/
│   └── index.ts                # #!/usr/bin/env bun entry: parse args, wire modules, signal handlers
├── server/
│   ├── args.ts                 # parseArgs wrapper -> CliOptions (validates --port, usage text)
│   ├── repo.ts                 # resolveRepoPath(): exists, is dir, readable, realpath
│   ├── config.ts               # loadConfig(): find file (repo then cwd), parse, validate, merge with flags
│   ├── port.ts                 # listenWithFallback(): try requested port, fall back to OS-assigned
│   ├── state.ts                # stateDir(), repoKey(), writeInstance(), readInstance(), removeInstance(), isStale()
│   ├── routes.ts               # /api/health handler, static serving + SPA fallback, dev proxy
│   ├── version.ts              # exports version from package.json
│   └── start.ts                # startServer(opts) -> { port, url, stop() }; used by CLI and tests
└── web/
    ├── index.html
    ├── main.tsx
    └── App.tsx                 # fetches /api/health, renders repo name placeholder

scripts/
└── dev.ts                      # spawns Vite dev server + server in dev mode; forwards <repo-path> and flags

tests/
├── args.test.ts
├── repo.test.ts
├── config.test.ts
├── port.test.ts
├── state.test.ts
├── server.test.ts              # health endpoint, static serving, read-only assertion
└── cli.e2e.test.ts             # spawn CLI, check server.json, SIGINT cleanup, error exits
```

**Structure Decision**: Single project. `src/server` holds small single-purpose modules so each can be implemented and tested independently; `src/web` is the Vite root so the UI build is self-contained; `src/cli/index.ts` is the only file with process-level side effects (signals, `process.exit`).

## Complexity Tracking

No constitution violations; nothing to justify.
