# Implementation Plan: Attention Hook

**Branch**: `005-attention-hook` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-attention-hook/spec.md`

## Summary

An opt-in Claude Code hook lets a main session show `waiting` (red) while it is blocked on the user. A standalone Bun script, `hooks/attention-hook.ts`, is referenced from the user's own `~/.claude/settings.json`. It appends one privacy-trimmed JSON line per event to `~/.agent-visualizer/hooks/events.jsonl` and always exits 0 in silence. A new attention source wraps the 004 transcript source behind the same `AgentSource` interface. It tails the events file, and marks a session `waiting` while any of its agents (the main agent or a subagent) has a wait-start event later than every clear for that same agent. A clear is a later turn entry in that agent's own transcript, or a matching wait-end hook event. `SessionEnd` removes the session until it is used again. `/api/sessions` gains the `waiting` state, and `/api/health` reports whether hook events are arriving.

Approach (see [research.md](./research.md)):
- **Hook events** (R1, R2, confirmed by probe): `PermissionRequest`, `PreToolUse` on `AskUserQuestion|ExitPlanMode` and `Elicitation` start a wait. `Notification` is not used.
- **Scoping** (R2): waits are scoped by `agent_id`, which matches the subagent transcript's file name.
- **Sync and async** (R3): wait-start hooks run synchronously, so their timestamp always comes before the answer. The other hooks run async, except `SessionEnd`.
- **Combination** (R5): a pure fold over maximum timestamps, so the result doesn't depend on the order the two files are read in.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Bun ≥ 1.2

**Primary Dependencies**: none new. The hook script uses only `node:fs`, `node:os` and `node:path`. The reader reuses 004's `FileTail`.

**Storage**: the events file in the visualizer's state directory, written only by the user-installed hook. The server only reads it. Combined state is held in memory.

**Testing**: `bun test`. Fixtures under `fixtures/attention/<scenario>/` (a `projects/` tree plus `events.jsonl`) reuse 004's placeholder helper. The hook script is tested via `Bun.spawn` with a temp `AGENT_VISUALIZER_STATE_DIR`.

**Target Platform**: macOS and Linux desktop, local only.

**Project Type**: local web app; this feature is server-side plus a hook script and contract changes.

**Performance Goals**:
- A wait shows in `/api/sessions` within 1 s (SC-003). The events file is polled every 500 ms.
- The hook script takes under 100 ms (SC-004). It does a single append, and Bun starts in about 20 to 40 ms.
- Async end hooks add no latency to a turn.

**Constraints**:
- Never write to transcripts, observed repos or Claude Code settings (Principle III).
- The hook prints nothing and always exits 0.
- No network.
- The UI imports only `src/contract/`.

**Scale/Scope**: a few events per turn across up to about 10 concurrent sessions; the events file grows by kilobytes per day.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan complies |
|-----------|--------|------------------------|
| I. Feature branches and PRs only | Pass | Work on `005-attention-hook`; ends in a PR. |
| II. Documentation ships with the code | Pass | Docs task: README section "Attention hook (optional)" with the settings snippet, `bun run hook-settings`, how to check it via `/api/health`, and how to remove it; `/api/sessions` `waiting` state; `docs/master-spec.md` hook mapping and per-agent wait rule. |
| III. Read-only observer | Pass | The visualizer only reads the events file and transcripts. The hook, installed by the user, writes only to the state directory. `hook-settings` prints and writes nothing. A test asserts fixtures are unchanged (SC-007). |
| IV. Framework-agnostic | Pass | Not touched. Claude Code hook knowledge is confined to `hooks/` and `src/agents/attention/`. |
| V. Test-backed and fixture-driven | Pass | Pure classifier and combine function get table tests; source gets fixture scenarios under every read order; hook script gets a spawn test. The tester writes them from the spec and contracts. |
| VI. Small, explicit tasks | Pass | One small module per concern (below). No dependency. |
| VII. Commit at every workflow step | Pass | Spec committed; plan artifacts committed at the end of this step. |
| VIII. Logical, incremental commits | Pass | One task per module, with its tests. |
| Tech: UI/server boundary | Pass | `SessionState` and the new `HealthResponse` live in `src/contract/`. |
| Tech: local-only | Pass | No network; the hook is a local command, not `type: "http"`. |

No violations. **Post-design re-check**: still passes. The design adds `hooks/`, `src/agents/attention/`, `src/contract/health.ts` and one script.

## Project Structure

### Documentation (this feature)

```text
specs/005-attention-hook/
├── plan.md
├── research.md              # R1 event mapping, R2 probe-confirmed fields, R3 script, R4–R8 combination rules
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── hook-events.md       # events file line format, mapping table, settings snippet
│   ├── agent-source.md      # session-ended event, transcript-source extras, attention source factory
│   └── http-api.md          # waiting state, health attentionHook field
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
hooks/
└── attention-hook.ts              # NEW: the user-installed hook (standalone, node built-ins only)

scripts/
└── hook-settings.ts               # NEW: prints the settings snippet with absolute paths (bun run hook-settings)

src/
├── contract/
│   ├── sessions.ts                # CHANGED: SessionState adds "waiting"
│   └── health.ts                  # NEW: HealthResponse incl. attentionHook
├── agents/
│   ├── source.ts                  # CHANGED: AgentSourceEvent adds session-ended
│   ├── transcripts/
│   │   ├── session-state.ts       # CHANGED: lastTurnAt in SessionStateT
│   │   └── source.ts              # CHANGED: clears(sessionId), onActivity(listener)
│   └── attention/
│       ├── hook-line.ts           # NEW: classifyHookLine(text) -> HookEvent | issue (pure, mapping table)
│       ├── combine.ts             # NEW: applyHookEvent(record, event), combine(base, record, clears, ...) (pure)
│       ├── settings.ts            # NEW: HOOK_EVENTS (event, matcher, async) + buildSettings(bunPath, scriptPath) (pure)
│       └── source.ts              # NEW: createAttentionSource(options)
├── server/
│   ├── routes.ts                  # CHANGED: health adds attentionHook via HandlerOptions.hookStatus
│   └── start.ts                   # CHANGED: pass hookStatus through
└── cli/index.ts                   # CHANGED: wrap the transcript source in the attention source (eventsFile from stateRoot())

fixtures/attention/
├── <scenario>/projects/…          # transcripts in 004 layout with placeholders
├── <scenario>/events.jsonl
└── README.md                      # scenario list and expected states

tests/
├── hook-script.test.ts            # NEW
├── hook-line.test.ts              # NEW
├── hook-settings.test.ts          # NEW: snippet events == mapping events; sync/async split; absolute paths
├── attention-combine.test.ts      # NEW
├── attention-source.test.ts       # NEW: fixtures, every read order, hold timeout, session end/revival, no file
├── session-state.test.ts          # CHANGED: lastTurnAt
├── transcript-source.test.ts      # CHANGED: clears(), onActivity()
├── sessions-api.test.ts           # CHANGED: waiting state passes through
├── server.test.ts                 # CHANGED: health attentionHook
└── cli.e2e.test.ts                # CHANGED: waiting via a temp state dir events file
```

**Structure Decision**: as in 004. The hook script lives at the top-level `hooks/` folder, not under `src/`, because users reference its path from their settings and it must not import server code. Claude Code hook knowledge (the mapping, the snippet) is in `src/agents/attention/`, beside the transcript source's Claude Code knowledge.

## Complexity Tracking

No constitution violations.
