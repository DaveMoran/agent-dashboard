# Implementation Plan: Common Spec Model and Adapter Contract

**Branch**: `002-common-model-adapter-interface` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-common-model-adapter-interface/spec.md`

## Summary

Add a framework-agnostic core under `src/core/`: the shared Spec, Task and Event types with runtime validation; an `Adapter` interface (`detect`, `discover`, `parse`) that works over one or more worktree roots; a validator that turns raw adapter output into accepted specs plus a list of issues (duplicates, bad status, unresolved and self dependencies, cycles, missing titles, duplicate task ids, malformed shapes) and never throws; an ordered adapter registry with deterministic detection and an optional forced adapter from `agent-visualizer.config.json`; and a debounced, read-only watcher that re-runs discovery and parsing on change and emits initial, spec-changed and error notifications while keeping the last good snapshot. No real adapter ships; a stub adapter and fixture repos live in `fixtures/stub/`. The CLI only gains a startup check that a forced adapter name exists.

## Technical Context

**Language/Version**: TypeScript (strict), Bun >= 1.2 (1.4.3 on the dev machine)

**Primary Dependencies**: None new. `node:fs` `watch` with `recursive: true` for watching, `Bun.Glob` for pattern matching, hand-written validation (no schema library), consistent with feature 001.

**Storage**: None. Snapshots are in memory.

**Testing**: `bun test` with fixtures in `fixtures/stub/`; watcher tests copy fixtures to temp dirs and use short debounce values passed as options.

**Target Platform**: Local developer machine. Recursive watching was verified on macOS (Bun 1.4.3) for nested directory creation, atomic rename saves and deletions; Linux behavior is unverified (see research).

**Project Type**: single project (adds a library-style core module to the existing CLI/server)

**Performance Goals**: Updated snapshot within 1 s of a single change (SC-004); bursts of 20 changes in 0.5 s produce one notification (SC-005); never more than 5 s stale under constant change (SC-006).

**Constraints**: Read-only toward the observed repo (FR-032, Principle III). `src/core/` must not name any spec framework (FR-009, Principle IV).

**Scale/Scope**: Tens of specs per repo, a handful of roots; about 7 source modules and 7 test files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Feature branches and PRs only | PASS | Work is on `002-common-model-adapter-interface`; the final task opens a PR. `main` is protected. |
| II. Documentation ships with code | PASS | New `docs/adapters.md` (authoring guide), README and master-spec updates are explicit tasks (FR-034). |
| III. Read-only observer | PASS | The watcher and scan only read; an automated test compares a fixture copy byte-for-byte before and after watching. |
| IV. Framework-agnostic through adapters | PASS | All framework knowledge stays in adapters; the production adapter list lives in `src/adapters/index.ts`, outside `src/core/`; a test fails if `src/core/` mentions any known framework name. |
| V. Test-backed and fixture-driven | PASS | Stub adapter and fixture repos under `fixtures/stub/`; every validation rule and watcher behavior has a test that fails when the behavior is removed. |
| VI. Small, explicit tasks | PASS | One module per concern so each task names one file. |
| VII. Commit at every workflow step | PASS | Spec committed (`202bc82`); this plan is committed before tasks. |
| VIII. Logical, incremental commits | PASS | Tasks are sized for one commit each. |

**Post-design re-check (after Phase 1)**: PASS. No new dependencies, no violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-common-model-adapter-interface/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── adapter.md       # Adapter interface and RepoContext
│   ├── watcher.md       # watchSpecs() API and notification shapes
│   └── config-file.md   # agent-visualizer.config.json v2 (adds "adapter"); supersedes 001's contract
└── tasks.md             # Phase 2 output (/speckit-tasks - NOT created here)
```

### Source Code (repository root)

```text
src/
├── core/                       # framework-agnostic; must not name any framework
│   ├── model.ts                # Spec, Task, Event, Issue, Snapshot types; STATUSES, ROLES constants
│   ├── validate.ts             # validateSpecs(), validateEvent(), findCycles()
│   ├── adapter.ts              # Adapter, RepoContext, WatchTarget types
│   ├── registry.ts             # createRegistry(), selectAdapter(), assertKnownAdapter(), UnknownAdapterError
│   ├── scan.ts                 # scan(): discover -> expand patterns -> parse -> validate -> Snapshot
│   └── watcher.ts              # watchSpecs(): recursive watch, debounce + max wait, notifications
├── adapters/
│   └── index.ts                # production adapter list (empty in this feature; 003 adds the first)
├── server/config.ts            # gains the optional "adapter" key
└── cli/index.ts                # checks a forced adapter name at startup

fixtures/
└── stub/
    ├── adapter.ts              # createStubAdapter(options): reads stub-specs/*.json
    ├── repo-a/stub-specs/*.json
    ├── repo-b/stub-specs/*.json    # second root, for multi-root tests
    └── invalid/stub-specs/*.json   # one file per validation problem

tests/
├── model.test.ts               # constants and event validation
├── validate.test.ts            # every spec validation rule
├── registry.test.ts            # detection order, ties, forced, unknown, failing detect
├── scan.test.ts                # multi-root, unreadable paths, parse failure
├── watcher.test.ts             # initial, change, burst, new files, failure/recovery, stop, max wait, read-only
├── core-agnostic.test.ts       # src/core/ never names a framework
├── config.test.ts              # (extended) "adapter" key
└── cli.e2e.test.ts             # (extended) unknown forced adapter exits 1 and lists names

docs/adapters.md                # adapter authoring guide (new)
```

**Structure Decision**: A new `src/core/` holds everything framework-agnostic; `src/adapters/` holds the production list so core never imports framework code; fixtures follow the constitution's `fixtures/` convention, and `tsconfig.json` adds `fixtures` to `include`. The watcher is not wired to the server or UI here (feature 006).

## Complexity Tracking

No constitution violations; nothing to justify.
