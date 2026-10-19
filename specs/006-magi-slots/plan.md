# Implementation Plan: MAGI Slots

**Branch**: `006-magi-slots` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-magi-slots/spec.md`

## Summary

Assign active projects to the three MAGI brains and serve them at `/api/magi`. The logic lives in a pure function, `stepSlots(prev, sessions, now, options)`, in `src/magi/slots.ts`:
- A main session is live while its last activity is within the idle timeout (30 min) or, if it is `waiting`, within the waiting timeout (4 h).
- A project with a live main session is active.
- Active projects take the lowest free brain, newest activity first, and keep it.
- A brain's state is `waiting > working > standby` over that project's live main sessions only.
- Each brain has a deterministic `stateSince`.

A small service, `src/magi/service.ts`, runs the step on every agent-source event and on a 1 s tick, so timeouts free brains without new events.

The CLI no longer needs a repo path. A path-less instance writes `<state-root>/magi/server.json`, reads config from the current directory, and reports `repoPath: null` in health. New contract types are in `src/contract/magi.ts`.

Approach (see [research.md](./research.md)):
- **R1**: path-less record location.
- **R2**: `idleTimeoutMinutes` and `waitingTimeoutMinutes`.
- **R3**: pure step plus a ticking service.
- **R4**: one ordering rule for first assignment, the queue and simultaneous activation.
- **R5**: state-since rule.
- **R6**: project path from the git common dir.
- **R7, R8**: nullable health and the optional CLI path.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Bun ≥ 1.2

**Primary Dependencies**: none new.

**Storage**: in-memory slot state. The only file written is the instance record in the state directory, as before.

**Testing**: `bun test`.
- Pure slot scenarios use `makeSession` from `tests/stub-agent-source.ts` and a numeric clock.
- The service is tested with `createStubAgentSource` and an injected `now`/`tickMs`.
- A fixture test runs the real transcript source on `fixtures/transcripts/` (`two-worktrees`, `non-main`, `plain-turn`) with `now` pinned near the fixture timestamps.
- CLI e2e uses the existing spawn harness with a temp state dir.

**Target Platform**: macOS and Linux desktop, local only.

**Project Type**: local web app; this feature is server-side, plus a contract and a one-line UI fallback.

**Performance Goals**:
- A state change shows in `/api/magi` within 1 s (the source polls every 500 ms and the step runs on each event).
- A timeout frees a brain within 1 to 2 s (1 s tick), well under the 5 s budget.
- Each step is O(sessions), with about 10 sessions.

**Constraints**:
- Read-only toward observed repos and transcripts (Principle III).
- Loopback only.
- No network.
- The UI imports only `src/contract/`.

**Scale/Scope**: 3 brains, about 10 sessions, a handful of projects.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan complies |
|-----------|--------|------------------------|
| I. Feature branches and PRs only | Pass | Work on `006-magi-slots`; ends in a PR. |
| II. Documentation ships with the code | Pass | Docs task: README covers starting without a path, `/api/magi`, the two timeout keys and where the path-less `server.json` lives. `docs/master-spec.md` gets the state-directory row (decided: `magi/server.json`), the brain timeout rule (idle 30 min, waiting 4 h) and the brain stateSince rule. |
| III. Read-only observer | Pass | The slot logic reads `AgentSource` only. The sole write is the instance record in the state directory (existing behavior). |
| IV. Framework-agnostic | Pass | No spec-framework code touched. |
| V. Test-backed and fixture-driven | Pass | `stepSlots` table tests for every FR-018 item, a service test with a fake clock, a fixture test through the real transcript source, and CLI e2e. The tester writes them from the spec and contracts. |
| VI. Small, explicit tasks | Pass | Contract types, config keys, state path, args, slots, service, routes, CLI wiring and docs are each one small task with its own test file. No dependency. |
| VII. Commit at every workflow step | Pass | Spec committed (`17c7b9a`); plan artifacts committed at the end of this step. |
| VIII. Logical, incremental commits | Pass | One commit per task with its tests. |
| Tech: UI/server boundary | Pass | `MagiResponse` and the nullable `HealthResponse` are in `src/contract/`. `magi/` is added to the boundary test's forbidden pattern. |
| Tech: local-only | Pass | No new I/O beyond the existing record. |

No violations. **Post-design re-check**: still passes. The design adds `src/magi/` (two files) and `src/contract/magi.ts`, and changes `config`, `state`, `args`, `routes`, `start`, `cli` and the UI placeholder.

## Project Structure

### Documentation (this feature)

```text
specs/006-magi-slots/
├── plan.md
├── research.md              # R1–R9 decisions
├── data-model.md            # liveness, active project, brain, slot state, record, config
├── quickstart.md
├── contracts/
│   ├── http-api.md          # /api/magi, nullable health
│   ├── cli.md               # optional path, record location, timeout config keys, messages
│   └── magi-service.md      # stepSlots, createMagiService, wiring
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── contract/
│   ├── magi.ts              # NEW: BrainState, BrainName, BrainProject, BrainView, MagiResponse
│   └── health.ts            # repoPath/repoName → string | null
├── magi/
│   ├── slots.ts             # NEW: pure stepSlots, isLive, projectPath, emptySlotState
│   └── service.ts           # NEW: createMagiService (events + 1 s tick)
├── server/
│   ├── args.ts              # path optional; usage text
│   ├── config.ts            # idleTimeoutMinutes, waitingTimeoutMinutes; optional repoPath
│   ├── state.ts             # instancePath(null) → magi/server.json; nullable repoPath
│   ├── routes.ts            # /api/magi; repo nullable
│   └── start.ts             # pass magi + nullable repo
├── cli/index.ts             # wiring
└── web/App.tsx              # "MAGI" heading when repoName is null

tests/
├── magi-slots.test.ts       # NEW
├── magi-service.test.ts     # NEW
├── magi-fixtures.test.ts    # NEW
├── contract-boundary.test.ts # add magi/ to forbidden pattern
├── config.test.ts, args.test.ts, state.test.ts, server.test.ts, cli.e2e.test.ts  # extended
```

**Structure Decision**: single project as in 001–005. The slot logic gets its own `src/magi/` folder. It is neither an agent source (`src/agents/`) nor HTTP plumbing (`src/server/`), and it is the core of the future MAGI server repo.

## Complexity Tracking

No constitution violations; nothing to justify.
