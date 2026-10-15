# Quickstart: validating the session ingester

## Prerequisites

- Bun ≥ 1.2 and git ≥ 2.31 on `PATH`.
- `bun install` done.

## 1. Automated checks

```sh
bun run verify
```

Expected: type check passes; the new test files listed in [plan.md](./plan.md) pass. In particular:

- `tests/session-state.test.ts` covers every acceptance scenario of spec US1 (prompt, tool call, tool result, final reply, subagent turn, interruption, one event per change).
- `tests/transcript-source.test.ts` runs every scenario under `fixtures/transcripts/` and checks the fixture files are byte-identical with unchanged mtimes afterwards (SC-006).
- `tests/transcript-project.test.ts` creates a temp repo with two worktrees and gets one project (SC-004).

## 2. Against fixtures through the real server

```sh
AGENT_VISUALIZER_TRANSCRIPTS_DIR="$(mktemp -d)" bun run dev -- .
```

Copy a fixture scenario into that directory (replacing the `{{…}}` placeholders with real paths, see `fixtures/transcripts/README.md`), then:

```sh
curl -s http://127.0.0.1:<port>/api/sessions
```

Expected: the projects and main sessions for that scenario, shaped as in [contracts/sessions-api.md](./contracts/sessions-api.md). Append a prompt line to one session file; within 1 s its `state` becomes `working`. Append a `final` assistant line; it returns to `standby`.

## 3. Live dogfood (manual, read-only)

```sh
bun run dev -- .
curl -s http://127.0.0.1:<port>/api/sessions
```

With this Claude Code session open on an Opus model, this repo appears as one project (worktrees included) with this session in it: `working` while a turn runs (including while a foreground subagent runs), `standby` after the reply. A Sonnet-only session in another repo does not appear. Setting `"mainAgentModel": "^claude-sonnet"` in `agent-visualizer.config.json` flips that. Setting it to `"("` prints a warning naming `mainAgentModel` at startup and uses the default.

Nothing under `~/.claude/projects` is modified (compare `ls -l` before and after, or watch mtimes of session files you are not using).
