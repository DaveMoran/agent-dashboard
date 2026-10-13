---

description: "Task list for 002-common-model-adapter-interface"
---

# Tasks: Common Spec Model and Adapter Contract

**Input**: Design documents from `/specs/002-common-model-adapter-interface/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (adapter, watcher, config-file), quickstart.md

**Tests**: Included. The spec requires them (FR-033). Every test must fail when the behavior it covers is removed (constitution Principle V): assert exact issue kinds, spec ids, kept/excluded outcomes, error messages and exit codes.

**Organization**: Grouped by user story. Complete phases in order; [P] tasks touch different files and can run in parallel.

## Working rules (from the constitution and CLAUDE.md)

- Work only on branch `002-common-model-adapter-interface`. In the main checkout run `git switch 002-common-model-adapter-interface` first (the planner worktree has released it). Never commit to `main`.
- One logical commit per task (or tightly related pair), with that task's checkbox ticked in the same commit. Every commit subject ends with `[spec-002]`.
- Do not edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/` or the constitution. If a contract is wrong or ambiguous, stop and report it.
- Nothing may write into an observed repo. Tests that need to change files work on copies of fixtures in temp directories (`fs.mkdtemp` under `os.tmpdir()`), never on `fixtures/` itself.
- `src/core/` must not mention any spec framework by name.
- Paths are relative to the repository root. TypeScript strict mode throughout. No new dependencies.

---

## Phase 1: Setup

- [x] T001 Run `git branch --show-current` (expect `002-common-model-adapter-interface`) and `bun run verify` (expect all 99 existing tests to pass) to confirm a green baseline before any change.
- [x] T002 In `tsconfig.json`, add `"fixtures"` to the top-level `include` array so fixture code is type-checked. Run `bunx tsc --noEmit`.

---

## Phase 2: Foundational (blocks all stories)

- [x] T003 Create `src/core/model.ts` with the types and constants from `data-model.md`: `STATUSES = ["drafted","planned","ready","in-progress","review","done","blocked"] as const`, `SpecStatus`, `ROLES = ["planner","coder","human","git"] as const`, `Role`, `Task` (`id: string; text: string; done: boolean; phase?: string; parallel?: boolean`), `SpecSource` (`{ root: string; branch?: string }`), `Spec` (`id`, `title`, `status: SpecStatus`, `dependsOn: string[]`, `tasks: Task[]`, `artifacts: string[]`, `branch?: string`, `source?: SpecSource`), `Event` (`ts: string; role: Role; specId?: string; kind: string; detail: unknown`), `IssueKind` (exactly the 11 kinds in the data-model catalogue), `Issue` (`kind`, `specId?`, `taskId?`, `message`, `related?: string[]`), `Snapshot` (`specs`, `issues`, `adapter: string | null`, `scannedAt: string`). Types and constants only, no logic.
- [x] T004 Create `src/core/adapter.ts` with `RepoContext`, `WatchTarget` and `Adapter` exactly as in `contracts/adapter.md`.
- [x] T005 [P] Create stub fixture data, one spec per JSON file, all with `"source"` omitted (the stub adds it):
  - `fixtures/stub/repo-a/stub-specs/001.json`: `{"id":"001","title":"First","status":"drafted"}`
  - `fixtures/stub/repo-a/stub-specs/002.json`: `{"id":"002","title":"Second","status":"planned","dependsOn":["001"],"artifacts":["stub-specs/002.json"],"branch":"002-second","tasks":[{"id":"T1","text":"Do a","done":true,"phase":"Setup"},{"id":"T2","text":"Do b","done":false,"parallel":true},{"id":"T3","text":"Do c","done":false}],"extra":"ignored"}`
  - `fixtures/stub/repo-a/stub-specs/003.json`: `{"id":"003","title":"Third","status":"ready","dependsOn":["002"]}`
  - `fixtures/stub/repo-b/stub-specs/004.json`: `{"id":"004","title":"Fourth","status":"in-progress"}`
  - `fixtures/stub/invalid/stub-specs/` with one file per problem, named after the issue kind: `bad-status.json` (`"status":"almost-done"`), `no-id.json` (no `id`), `not-object.json` (content `[1,2]`), `no-title.json` (`id` `"T"`, no title), `dup-a.json` and `dup-b.json` (both `id` `"D"`, different titles), `dup-task.json` (two tasks with id `"T1"`), `bad-task.json` (one task missing `done`), `unresolved.json` (`dependsOn:["ZZZ"]`), `self.json` (`id` `"S"`, `dependsOn:["S"]`), `cycle-a.json`/`cycle-b.json`/`cycle-c.json` (ids `"CA"`→`"CB"`→`"CC"`→`"CA"`). Every file not about status uses a valid status.
- [x] T006 [P] Create `fixtures/stub/adapter.ts` exporting `createStubAdapter(options?: { name?: string; detect?: boolean | "throw"; patterns?: string[] }): Adapter` (import the `Adapter`, `RepoContext` and `WatchTarget` types from `src/core/adapter.ts`, created in T004). Defaults: `name` `"stub"`, `patterns` `["stub-specs/*.json"]`. `detect(ctx)`: if `options.detect === "throw"` throw `new Error("stub detect failure")`; if a boolean, return it; otherwise return true when any root contains a `stub-specs` directory. `discover(ctx)`: one `WatchTarget` per root with the patterns. `parse(ctx, files)`: for each file, read text; if the trimmed text is exactly `FAIL` throw `new Error("stub parse failure in <file>")`; otherwise `JSON.parse` it and, if the result is a plain object without `source`, set `source = { root }` where `root` is the `ctx.roots` entry that contains the file. Return the parsed values in file order (non-objects returned unchanged so validation sees them).

**Checkpoint**: `bunx tsc --noEmit` passes.

---

## Phase 3: User Story 1 - Write an adapter against one stable contract (Priority: P1) 🎯 MVP

**Goal**: Valid adapter output comes back through the core in the shared shape, across one or more roots, with no framework names in core.

**Independent Test**: Quickstart sections 1-2 for the scan tests; `tests/scan.test.ts` and `tests/core-agnostic.test.ts`.

- [x] T007 [US1] Create `src/core/validate.ts` exporting `validateSpecs(raw: unknown[]): { specs: Spec[]; issues: Issue[] }` covering normalization of valid input only (US2 adds the remaining rules): skip non-objects and objects without a non-empty string `id` with issue `invalid-shape`; copy only known fields; default `dependsOn`, `tasks`, `artifacts` to `[]`; keep tasks in order; include `phase` and `parallel` only when the raw task has them; include `branch` and `source` only when present. It must never throw.
- [x] T008 [US1] Create `src/core/scan.ts` exporting `scan(adapter, ctx)` per `contracts/watcher.md` ("scan" section): `adapter === null` gives an empty snapshot with `adapter: null`; call `discover`; for each target expand its patterns with `new Bun.Glob(pattern).scan({ cwd: target.root, onlyFiles: true })`, skipping any relative path that starts with `.git/` or `node_modules/` or contains `/.git/` or `/node_modules/`; an unreadable root or directory adds an `unreadable-path` issue naming the path and is skipped; sort absolute file paths; call `parse`; run `validateSpecs`; return `{ ok: true, snapshot }` with `adapter: adapter.name` and `scannedAt` as ISO-8601. If `discover` or `parse` throws, return `{ ok: false, error: { stage, message } }`. `scan` never throws.
- [x] T009 [US1] Create `tests/scan.test.ts` using `createStubAdapter`: repo-a gives exactly specs `001`, `002`, `003` in that order with every field preserved (assert `002` deeply, including task order, `phase` only on T1, `parallel` only on T2, `branch`, `artifacts`, `source.root`) and no `extra` field; roots `[repo-a, repo-b]` give 4 specs, with `004` having `source.root` equal to repo-b; `adapter === null` gives an empty snapshot; a stub whose `discover` is replaced to throw gives `ok: false` with `stage: "discover"`; a copy of repo-a with `stub-specs/001.json` containing `FAIL` gives `ok: false` with `stage: "parse"` and a message containing `stub parse failure`; patterns `["**/*.json"]` on a copy containing `node_modules/x/stub-specs/9.json` and `.git/9.json` do not include those files; an unreadable root (temp copy chmod `000`, restored in `finally`; skip when running as root) gives an `unreadable-path` issue and still returns `ok: true`.
- [x] T010 [P] [US1] Create `tests/core-agnostic.test.ts` that reads every `.ts` file under `src/core/` and fails if any contains, case-insensitively, `spec kit`, `speckit`, `spec-kit`, `openspec`, `bmad` or `.specify`. Verify it fails by temporarily adding a comment containing `openspec` to a core file, then remove it.
- [x] T011 [P] [US1] Create `src/adapters/index.ts` exporting `export const adapters: Adapter[] = [];` with a one-line comment that feature 003 adds the first adapter.

**Checkpoint**: `bun test tests/scan.test.ts tests/core-agnostic.test.ts` passes.

---

## Phase 4: User Story 2 - Bad adapter output is reported, never fatal (Priority: P1)

**Goal**: Every rule in the data-model issue catalogue is applied, with the specified keep/exclude effect, and validation never throws.

**Independent Test**: `tests/validate.test.ts` against the `invalid` fixture and inline inputs.

- [x] T012 [US2] Extend `validateSpecs` in `src/core/validate.ts` with every per-spec rule from the data-model catalogue, in this order: `missing-title` (no usable title: keep, `title = id`); `invalid-status` ("Must be in `STATUSES`, else the spec is excluded"); `invalid-task` (task missing `id`, `text` or `done`, or wrong types: drop the task, keep the spec); `duplicate-task-id` (both kept, issue names the task id); non-string `dependsOn` entries dropped with `invalid-shape`; `duplicate-id` (first occurrence kept, later ones excluded, message names the id). Messages name the values involved.
- [x] T013 [US2] Add dependency checks to `src/core/validate.ts`, run on the accepted specs after duplicates are removed: `unresolved-dependency` (spec kept; `related` = [missing id]); `self-dependency` (spec kept; not also reported as a cycle); `dependency-cycle` via an exported `findCycles(specs): string[][]` using Tarjan's strongly connected components, one issue per component of 2+ specs, `related` sorted, `specId` = smallest id. Order dependency issues by spec id so output is deterministic.
- [x] T014 [US2] Create `tests/validate.test.ts`: one test per issue kind using the `invalid` fixture files (load them through the stub adapter and `scan`, or read and pass them directly), each asserting the exact `kind`, `specId`/`taskId`/`related`, and whether the spec is present in `specs`; a combined test that feeds all invalid files at once and asserts validation returns without throwing and reports every kind; the A→B→C→A cycle is reported exactly once; a spec with both an unresolved dependency and a cycle gets both issues; repo-a's valid specs produce zero issues. Mutation check: temporarily make `findCycles` return `[]` and confirm a test fails, then restore.

**Checkpoint**: `bun test tests/validate.test.ts` passes.

---

## Phase 5: User Story 3 - The right adapter is chosen automatically, or by configuration (Priority: P2)

**Goal**: Deterministic selection, a forced adapter from config, and a clear startup error for unknown names.

**Independent Test**: `tests/registry.test.ts`, the extended config and CLI tests, and quickstart section 4.

- [x] T015 [US3] Create `src/core/registry.ts` per `contracts/adapter.md` ("Registry"): `createRegistry(adapters)` (throws `Error` on duplicate names), `selectAdapter(registry, ctx, forced?)` returning `{ adapter, matched, forced, warnings, issues }` (run every `detect` in registration order; a throwing `detect` counts as no match and adds a `detect-failed` issue naming the adapter), `assertKnownAdapter(name, registry)`, and `UnknownAdapterError extends AppError` (from `src/server/errors.ts`) with message `Unknown adapter "<name>". Available adapters: <a, b>` or `Available adapters: none registered`.
- [x] T016 [US3] Create `tests/registry.test.ts`: single match selected; two matching stubs (`name` `"first"`, `"second"`) select `"first"` in 10 repeated runs with `matched` `["first","second"]`; no match gives `adapter: null`; forced `"second"` selected with `forced: true`; forced adapter whose `detect` is false is selected with the exact warning text; forced unknown name throws `UnknownAdapterError` with the exact message listing names; empty registry gives `none registered`; a `detect: "throw"` stub yields `detect-failed` and the next adapter is still selected; duplicate names in `createRegistry` throw.
- [x] T017 [US3] Extend `src/server/config.ts`: `Config` gains `adapter: string | undefined`; read `adapter` from the same file as `port`; a present value that is not a non-empty string throws `ConfigValueError` with `Invalid config in <file>: "adapter" must be a non-empty string, got <JSON value>`. Extend `tests/config.test.ts` with: valid `adapter` read; absent gives `undefined`; `5`, `""` and `null` each rejected with that message; `port` behavior unchanged.
- [x] T018 [US3] In `src/cli/index.ts`, after `loadConfig`, call `assertKnownAdapter(config.adapter, createRegistry(adapters))` (from `src/core/registry.ts` and `src/adapters/index.ts`) before checking for a running instance. Extend `tests/cli.e2e.test.ts`: config `{"adapter":"nope"}` exits 1 with stderr containing `Unknown adapter "nope". Available adapters: none registered` and starts no server; `{"adapter":5}` exits 1 with the invalid-config message; no `adapter` key still prints exactly the three startup lines from 001.

**Checkpoint**: `bun test` passes, including all existing 001 tests.

---

## Phase 6: User Story 4 - Spec changes show up on their own (Priority: P2)

**Goal**: A read-only, debounced watcher with initial, spec-changed and error notifications, per `contracts/watcher.md`.

**Independent Test**: `tests/watcher.test.ts` and quickstart section 3.

- [x] T019 [US4] Create `src/core/watcher.ts` exporting `watchSpecs(options)` and the `Notification` and `SpecWatcher` types exactly as in `contracts/watcher.md`, implementing behaviors 1-8 there: initial scan and notification before resolving; `fs.watch(root, { recursive: true })` per root; ignore `.git/` and `node_modules/`; count an event as a change if its relative path matches any current pattern for that root (`new Bun.Glob(p).match(rel)`) or is a directory; quiet timer `debounceMs` (default 150) restarted per change plus a max-wait timer `maxWaitMs` (default 2000) started on the first change; no overlapping scans (one follow-up scan if changes arrive mid-scan); refresh patterns from each successful scan's `discover`; on failure emit `error` with the last good snapshot (or an empty one) and keep `current()`; `stop()` closes watchers, clears timers, awaits an in-flight scan and suppresses later notifications. Treat an `fs.watch` error on a root as an `unreadable-path` issue on the next snapshot rather than a crash.
- [x] T020 [US4] Create `tests/watcher.test.ts`, each test on a fresh temp copy of `fixtures/stub/repo-a`, with a helper that collects notifications and waits for the next one with a timeout. Cases: `initial` arrives first with 3 specs; editing `002.json`'s title gives one `spec-changed` within 1 s using default timings, with the new title; 20 writes to `001.json` 20 ms apart give exactly one notification after they stop (wait an extra 500 ms to confirm no second); writing a new `stub-specs/005.json` adds spec `005`; writing `FAIL` into `003.json` gives `error` with `stage: "parse"` and a snapshot still containing 3 specs, and `current()` unchanged; restoring valid JSON gives `spec-changed`; writes every 50 ms for 3 s produce at least one notification within `maxWaitMs + 500 ms` of the first write (use `debounceMs: 150`, `maxWaitMs: 1000`); after `stop()`, further writes produce no notification within 1 s; writing a file under `node_modules/stub-specs/` produces no notification; byte-for-byte comparison of every file in a separate untouched copy before and after a full watch session shows no change (read-only). Run `bun test tests/watcher.test.ts` three times in a row; all runs must pass.

**Checkpoint**: watcher tests pass 3 times in a row.

---

## Phase 7: User Story 5 - Activity has a shared shape too (Priority: P3)

**Goal**: Events validate against the shared shape.

**Independent Test**: `tests/model.test.ts`.

- [x] T021 [US5] Add `validateEvent(raw: unknown)` to `src/core/validate.ts` returning `{ ok: true; event: Event }` or `{ ok: false; reason: string }`: `ts` must be a string that `Date.parse` accepts; `role` must be in `ROLES`; `kind` a non-empty string; `specId`, if present, a string; `detail` passed through. `reason` names the failing field.
- [x] T022 [US5] Create `tests/model.test.ts`: `STATUSES` and `ROLES` equal the exact lists; a valid event of each role is accepted with and without `specId`; missing `ts`, `ts: "yesterday"`, `role: "robot"`, empty `kind` and numeric `specId` are each rejected with a reason naming the field.

---

## Phase 8: Polish, Documentation and PR

- [x] T023 Create `docs/adapters.md`: what an adapter is; the shared model (fields and status vocabulary, linking `specs/002-common-model-adapter-interface/data-model.md`); the three operations and their rules (from `contracts/adapter.md`); how patterns and multiple roots work; what validation does with bad output (the issue catalogue); how to register an adapter in `src/adapters/index.ts`; the `adapter` config key and its errors; how to test an adapter with fixtures (point to `fixtures/stub/` as the example).
- [x] T024 Update `README.md`: add `adapter` to the config file table (type, meaning, error); add a short "Spec adapters" section linking `docs/adapters.md`; add `src/core/` and `src/adapters/` to the project structure list.
- [x] T025 Update `docs/master-spec.md`: add a Decisions row "Watching | Recursive watch per root, filtered by adapter patterns; 150 ms quiet period, 2 s maximum delay; full snapshot per notification" and a sentence under the adapter contract pointing to `docs/adapters.md`.
- [x] T026 Walk through every section of `specs/002-common-model-adapter-interface/quickstart.md` for real; fix the code or report any mismatch with the quickstart (do not edit the quickstart's expected outcomes without saying why).
- [x] T027 Run `bun run verify` three times in a row and `bun run build`; all must pass. Fix failures before continuing.
- [x] T028 Confirm `git status` is clean (no temp files, no `node_modules`, no `dist`), every task above is ticked, and all work is committed with `[spec-002]`.
- [x] T029 Push `002-common-model-adapter-interface` and open a pull request to `main` with `gh pr create`. Description: summary of the spec, link to `specs/002-common-model-adapter-interface/`, documentation updated (T023-T025), results of T026-T027, and anything not verified. End the description with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge it; the maintainer reviews and merges.

---

## Dependencies & Execution Order

- Phase 1 and Phase 2 come first. Within Phase 2, T003 and T004 (core types) come before T005 and T006 (fixtures and stub), which can then run in parallel.
- US1 (Phase 3) needs Phase 2. US2 (Phase 4) extends `validate.ts` from US1. US3 (Phase 5) needs `adapter.ts` and the stub only. US4 (Phase 6) needs `scan.ts` from US1. US5 (Phase 7) extends `validate.ts`.
- Recommended order: US1 → US2 → US3 → US4 → US5 → Polish. US3 and US5 are independent of each other and of US4.

### Parallel opportunities

- Foundational: T005 and T006 (different files), after T003-T004.
- US1: T010 and T011 alongside T007-T009.
- After US1: US3 (registry, config, CLI) can proceed in parallel with US2 (validation), since they touch different files.
- Polish: T023, T024 and T025.

## Implementation Strategy

1. Phases 1-3 give the MVP: the contract and a working scan through the stub. Stop and run `bun run verify`.
2. Add US2 (validation), then US3 (selection and config), then US4 (watcher), then US5 (events), running `bun run verify` after each phase.
3. Finish with Phase 8. The documentation tasks are required, not optional.

---

## Review follow-ups

- [x] R1 `src/core/scan.ts`: replace `Bun.Glob.scan` with a directory walk per root that never descends into `.git` or `node_modules`, skips each unreadable directory individually with an `unreadable-path` issue naming it, and matches relative file paths with `new Bun.Glob(pattern).match()`. Tests in `tests/scan.test.ts`.
- [ ] R2 `fixtures/stub/adapter.ts`: add an optional `parseDelayMs` option. Use it in `tests/watcher.test.ts`: a change written while a scan is in flight produces a later `spec-changed` with the new content.
- [ ] R3 `src/core/watcher.ts`: start the OS watchers before the initial scan; if a relevant event arrives during the initial scan, run one follow-up scan after the initial notification. Test with `parseDelayMs`.
- [ ] R4 `tests/watcher.test.ts`: calling `stop()` while a slow scan is in flight emits no notification after `stop()` resolves.
- [ ] R5 `src/core/watcher.ts`: deduplicate watch-error issues so the same message is never repeated in a snapshot.
- [ ] R6 `README.md`: update the opening status paragraph to describe the current state.
