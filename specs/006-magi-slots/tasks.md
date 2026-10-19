---

description: "Task list for 006-magi-slots"
---

# Tasks: MAGI Slots

**Input**: Design documents from `/specs/006-magi-slots/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (http-api, cli, magi-service), quickstart.md

**Tests**: Included. The spec requires fixture-driven tests with a controllable clock (FR-018), and the constitution requires tests that fail when the behavior is removed (Principle V). Assert exact brain numbers, project ids, states, `stateSince` strings, exit codes and messages. Use `toStrictEqual` on whole `BrainView` objects wherever possible.

**Who does what** (constitution 1.4.0, `CLAUDE.md`):
- **(tester → coder)**: the `tester` agent first writes the named test files from the spec and contracts, without reading the implementation. The `coder` agent then implements until they pass, without changing the tests.
- **(tester)**: test-only work. If its new tests fail, the planner sends the failures to a coder, who fixes the code (not the tests).
- **(coder)**: wiring or docs, done by a single coder.
- In every case the planner runs `bun run verify`, then commits tests, code and the ticked box together, one commit per task.

**Organization**: grouped by user story, P1 stories first (US1, US2, US3, US5), then US4 (P2).
- US1 builds the slot core (`stepSlots` with the full assignment rule of research R4), the service, `/api/magi` and the CLI wiring.
- US2 and US4 mostly add tests on that core.
- US3 adds the `stateSince` rule.
- US5 makes the repo path optional.
- [P] tasks touch different files and may run in parallel within their phase.

## Working rules

- Work only on branch `006-magi-slots`. Every commit subject ends with `[spec-006]`.
- Do not edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/` or the constitution. If a contract is wrong or ambiguous, stop and report.
- Read-only: nothing in `src/magi/` does I/O. The only file the app writes is the instance record (existing behavior, new location for the path-less case).
- **No test may read `~/.claude` or `~/.agent-visualizer`.** Point `AGENT_VISUALIZER_STATE_DIR` and `AGENT_VISUALIZER_TRANSCRIPTS_DIR` at temp dirs. Copy fixtures before use; nothing writes into `fixtures/`.
- `src/contract/` imports nothing. `src/web/` imports only `src/contract/`.
- **Clock in tests**: never call `Date.now()` in slot tests. Use a helper `ms("10:30")` that returns `Date.parse("2026-10-18T10:30:00.000Z")`, and `iso("10:30")` for the ISO string. Times in this file are written `10:30` for short and are on 2026-10-18, except the fixture test in T009, which uses the 004 fixtures' 2026-10-15 times.
- **Default options in slot tests**: `{ idleMs: 30 * 60_000, waitingMs: 240 * 60_000 }`.
- Build sessions with `makeSession` from `tests/stub-agent-source.ts`. Give each project its own `projectId`, for example `"/a/.git"`, `"/b/.git"`, `"/c/.git"`, `"/d/.git"`, `"/e/.git"`, with `projectName` `a` to `e`.
- TypeScript strict, no new dependencies. Run `bun run verify` before ticking any task that changes code.

---

## Phase 1: Setup

- [X] T001 (planner) Run `git branch --show-current` (expect `006-magi-slots`) and `bun run verify` (expect all existing tests to pass) to confirm a green baseline. No commit.

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: contract types and the timeout config keys.

- [X] T002 [P] (coder) Contract types. Files: `src/contract/magi.ts` (new), `src/contract/health.ts`, `tests/contract-boundary.test.ts`.
  - Create `src/contract/magi.ts` exactly as in `contracts/http-api.md`. It exports `BrainState`, `BrainName`, `BrainProject`, `BrainView` and `MagiResponse`, starts with the comment `// Types for GET /api/magi. This file must import nothing.` and has no imports.
  - In `src/contract/health.ts` change `repoPath` and `repoName` to `string | null`.
  - In `tests/contract-boundary.test.ts` add `magi\/` to the `FORBIDDEN` pattern: `/(server\/|agents\/|core\/|adapters\/|git\/|magi\/)/`.
  - In `src/web/App.tsx` change the local `Health` type to `repoPath: string | null; repoName: string | null` so it type-checks. Leave the rendering change to T014.
  - Acceptance: `bun run verify` passes.
- [X] T003 [P] (tester → coder) Timeout config keys and optional repo path (`contracts/cli.md` "Config file", research R2/R8). Test file: `tests/config.test.ts` (add tests). Code: `src/server/config.ts`.
  - `Config` gains `idleTimeoutMinutes: number | undefined` and `waitingTimeoutMinutes: number | undefined`. Both are `undefined` when absent and when no file is found.
  - Each, if present, must be `typeof === "number"`, `Number.isFinite`, and `> 0`. Otherwise throw `ConfigValueError` with the exact message `Invalid config in <file>: "<key>" must be a positive number of minutes, got <JSON.stringify(value)>`.
  - The signature becomes `loadConfig(repoPath: string | undefined, cwd = process.cwd())`. It searches `[repoPath, cwd]` when `repoPath` is given and `[cwd]` when it is `undefined`.
  - Tests:
    - `{ "idleTimeoutMinutes": 10, "waitingTimeoutMinutes": 0.5 }` loads as `10` and `0.5`;
    - absent keys give `undefined`;
    - each key with `0`, `-1`, `"30"`, `null` and `true` throws `ConfigValueError` with the exact message (check that the message names the key and the JSON value; for `"30"` the message ends `got "30"`);
    - `loadConfig(undefined, cwdWithConfig)` reads the cwd file;
    - `loadConfig(undefined, emptyDir)` returns all-`undefined` with `source: undefined`;
    - the existing tests still pass unchanged.

**Checkpoint**: contract compiles, config validated.

---

## Phase 3: User Story 1 - Each active project gets its own brain (Priority: P1) 🎯 MVP

**Goal**: active projects take the lowest free brain and keep it; `/api/magi` serves the three brains.

**Independent Test**: `tests/magi-slots.test.ts` (pure, fake clock), `tests/magi-service.test.ts`, `tests/server.test.ts` (`/api/magi`).

- [X] T004 [US1] (tester → coder) Slot core. Test file: `tests/magi-slots.test.ts` (new). Code: `src/magi/slots.ts` (new). Implement `contracts/magi-service.md` "`src/magi/slots.ts`" except the `stateSince` rule (T010): for now every brain's `stateSince` is `null`. T004 tests must not assert `stateSince`; compare brains with `stateSince` left out, or use `expect.objectContaining`.
  - `BRAIN_NAMES = ["MELCHIOR", "BALTHASAR", "CASPER"] as const`.
  - `emptySlotState()`: three brains, numbers 1–3 with those names, `state: "not-active"`, `stateSince: null`, `project: null`; `prevLive` an empty `Map`; `started: false`.
  - `projectPath(id)`: `path.basename(id) === ".git" ? path.dirname(id) : id`. Use `node:path` only for string work, with no file access.
  - `isLive(session, nowMs, options)` (data-model "Live main session"): `isMain`, `lastActivity` defined and `Date.parse` finite, and `nowMs - Date.parse(lastActivity) <= (session.state === "waiting" ? waitingMs : idleMs)`.
  - `stepSlots(prev, sessions, nowMs, options)` (research R4):
    1. Take the live sessions. Group them by `projectId` into active projects with `activity` (max `lastActivity`), `name` (the `projectName` of the session with the latest `lastActivity`), `path` and `state` (`waiting` if any live session waits, else `working` if any works, else `standby`).
    2. Free each brain whose project is not active: `project: null`, `state: "not-active"`.
    3. Keep brains whose project is still active. Update their `state`, and their `project.name` if it changed.
    4. Sort the unassigned active projects by `activity` descending, then `id` ascending. Give them to the free brains in brain-number order until none are left. The rest get no brain.
    5. Return a new state with `prevLive` = the live sessions' `sessionId → projectId` and `started: true`. Do not mutate `prev`.
  - Tests (all at `now = 10:30` unless stated, with default options):
    - `projectPath("/x/repo/.git")` is `"/x/repo"`; `projectPath("/x/plain")` is `"/x/plain"`; `projectPath("/x/bare.git")` is `"/x/bare.git"`.
    - `isLive`:
      - true at exactly 30 min of age for `standby` and false at 30 min + 1 ms;
      - `working` follows the same rule;
      - `waiting` is live at 3 h and false at 4 h + 1 ms;
      - `isMain: false` is never live;
      - `lastActivity: undefined` or `"nope"` is never live;
      - a future `lastActivity` (10:40) is live.
    - Empty sessions keep three not-active brains.
    - One live session in `a` gives MELCHIOR `{ id: "/a/.git", name: "a", path: "/a" }`, BALTHASAR and CASPER not-active (scenario US1-1).
    - Step 1 has `a`; step 2 adds `b` and step 3 adds `c` (newer activity each time): `a` on 1, `b` on 2, `c` on 3 (US1-2).
    - From `a` 1 and `b` 2, remove `a`'s session: MELCHIOR not-active and `b` still on BALTHASAR (US1-3). Then add `d`: `d` takes MELCHIOR (US1-4).
    - `a` holds 1; add a second live session in `a` (another `sessionId`, `cwd` `/a-wt`): `a` stays on 1 and the other brains stay free (US1-5).
    - A project with only `isMain: false` sessions takes no brain (US1-6).
    - State combination in one project: `standby` + `working` gives `working`; `working` + `waiting` gives `waiting`; `standby` + `standby` gives `standby` (US3-1..3).
    - A session that left `sessions()` (ended) frees its brain at the next step (US2-1).
    - `stepSlots` does not mutate `prev` (deep-equal `prev` before and after), and the same inputs give `toStrictEqual` outputs.
- [X] T005 [US1] (tester → coder) MAGI service. Test file: `tests/magi-service.test.ts` (new). Code: `src/magi/service.ts` (new). Implement `contracts/magi-service.md` "`src/magi/service.ts`".
  - `createMagiService({ source, idleMs, waitingMs, now = Date.now, tickMs = 1000 })` keeps a `SlotState` (starts `emptySlotState()`).
  - `start()` subscribes to `source`, runs one step and starts `setInterval(step, tickMs)`.
  - Each source event runs one step with `source.sessions()` and `now()`.
  - `refresh()` runs one step.
  - `brains()` returns a copy of the three brains (a caller mutating it must not change the service's state).
  - `stop()` unsubscribes and clears the interval. Steps after `stop()` do nothing.
  - Tests use `createStubAgentSource` and `makeSession` from `tests/stub-agent-source.ts`, plus a mutable fake clock (`let t = ms("10:30"); now: () => t`):
    - Before `start()`, `brains()` is three not-active brains.
    - After `start()` with one live session in `a`, MELCHIOR holds `a`.
    - `setSessions([...a, b])` then `emit({ type: "session-added", session: b })` puts `b` on BALTHASAR, with no `refresh()` call.
    - With `tickMs: 10`, set `t` past the idle timeout and `await Bun.sleep(60)` with no events: MELCHIOR is not-active.
    - After `stop()`, emitting an event and sleeping past a tick changes nothing.
    - Mutating the array returned by `brains()` does not change the next `brains()`.
- [ ] T006 [US1] (tester → coder) `/api/magi` route (`contracts/http-api.md`). Test file: `tests/server.test.ts` (add tests). Code: `src/server/routes.ts`, `src/server/start.ts`.
  - `HandlerOptions` and `StartOptions` gain `magi?: { brains(): BrainView[] }`, and `startServer` passes it through.
  - `GET /api/magi` returns `Response.json({ brains } satisfies MagiResponse)`. With no `magi`, `brains` is the three brains of `emptySlotState()`.
  - Other methods get `405` with `Allow: GET`.
  - Tests:
    - with no `magi`, the body `toStrictEqual`s three not-active brains with `stateSince: null` and `project: null`, in order MELCHIOR, BALTHASAR, CASPER;
    - with a stub `magi` returning a fixed array, the body equals that array;
    - `POST` gives `405` with `Allow: GET`;
    - `/api/sessions` and `/api/health` are unchanged.
- [ ] T007 [US1] (tester → coder) CLI wiring of the service. Test file: `tests/cli.e2e.test.ts` (add one test). Code: `src/cli/index.ts`.
  - After `source.start()`, create `createMagiService({ source, idleMs: (config.idleTimeoutMinutes ?? 30) * 60_000, waitingMs: (config.waitingTimeoutMinutes ?? 240) * 60_000 })` and call `start()`. Pass `magi: service` to `startServer`.
  - Call `service.stop()` before `source.stop()` in every path that stops the source: start failure, `writeInstance` failure and `shutdown`.
  - Pass `repo.path` to `loadConfig` as now (the path is still required until T013/T014).
  - Test: start with the temp repo path and the empty transcripts dir. `GET /api/magi` answers `200` with three not-active brains.

**Checkpoint**: `/api/magi` shows live projects on brains. MVP.

---

## Phase 4: User Story 2 - Brains free up when work stops (Priority: P1)

**Goal**: timeouts (idle 30 min, waiting 4 h) and session end free brains, with no new events needed. A stale `working` session stops counting.

**Independent Test**: timeout scenarios in `tests/magi-slots.test.ts`, the tick in `tests/magi-service.test.ts`, and the real transcript source in `tests/magi-fixtures.test.ts`.

- [ ] T008 [US2] (tester) Timeout scenarios. Test file: `tests/magi-slots.test.ts` (add a `describe("US2 timeouts")`). The code should already pass from T004; if a test fails, the planner sends it to a coder to fix `src/magi/slots.ts`.
  - `a` standby, last activity 10:00: at `now = 10:30` MELCHIOR holds `a`; at `10:30:00.001` it is not-active (US2-2).
  - `a` has two sessions; one ends (removed) while the other is live: `a` keeps MELCHIOR (US2-3).
  - `a` has one session `working`, last activity 10:00, and no other session: at `10:31` MELCHIOR is not-active (US2-4).
  - `a` has session X `working` (last activity 09:00) and session Y `standby` (last activity 10:20): at `10:30` MELCHIOR holds `a` with state `standby` (X does not count, US2-5).
  - A freed project with new activity becomes active again. `a` on 1 and `b` on 2; `a` times out; then `a` gets activity at 11:00. With `b` still on BALTHASAR, `a` takes MELCHIOR. With `c` taking MELCHIOR first, `a` takes CASPER (US2-6).
  - With `idleMs = 10 * 60_000`, a standby session silent for 11 min is not live (US2-7).
  - `a` `waiting`, last activity 10:00: at `10:45` MELCHIOR holds `a` with state `waiting`; at `14:00` still held; at `14:00:00.001` not-active (US2-8, US2-9).
  - `a` `waiting` since 10:00, answered at 10:50 (now `working`, last activity 10:50): live at `11:20`, not live at `11:20:00.001`.
- [ ] T009 [P] [US2] (tester) Fixture test through the real transcript source. Test file: `tests/magi-fixtures.test.ts` (new).
  - Materialize `fixtures/transcripts/two-worktrees` and `fixtures/transcripts/non-main` with `materializeTranscripts` from `tests/transcript-fixtures.ts`, using the variables they need (see `fixtures/transcripts/README.md` and how `tests/transcript-fixture-scenarios.test.ts` builds its git repo and worktree with `tests/git-helpers.ts`).
  - Create `createTranscriptSource({ root, mainAgentPattern: /^claude-(opus|fable)/ })`, `await start()`, and run a `createMagiService` with an injected `now` and `refresh()`. No ticking is needed; use a large `tickMs`. Stop both in `afterEach`.
  - `two-worktrees` (repo session working, last activity `2026-10-15T10:05:...`; worktree session standby, last activity 10:02):
    - at `2026-10-15T10:10:00.000Z`, MELCHIOR holds one project whose `path` is the realpath of the repo's main checkout and whose state is `working`; BALTHASAR and CASPER are not-active;
    - at a `now` 31 min after the repo session's last activity, MELCHIOR is not-active, which shows the stale `working` session stops counting.
  - `non-main`: at a `now` 1 min after its latest line, all three brains are not-active.
  - Assert nothing under `fixtures/` changed (compare file contents before and after, as `tests/transcript-fixtures.test.ts` does).

**Checkpoint**: brains free on timeout and on session end; a crashed `working` session cannot hold a brain.

---

## Phase 5: User Story 3 - See what each brain's agent is doing (Priority: P1)

**Goal**: deterministic `stateSince` per research R5.

**Independent Test**: `describe("US3 stateSince")` in `tests/magi-slots.test.ts`.

- [ ] T010 [US3] (tester → coder) `stateSince` rule. Test file: `tests/magi-slots.test.ts` (add `describe("US3 stateSince")`). Code: `src/magi/slots.ts`. Implement research R5 and data-model `prevLive`:
  - **Drop times this step**: for each `sessionId` in `prev.prevLive` that is not live now:
    - if it is still in `sessions` and has a parseable `lastActivity`, it drops at `min(nowMs, Date.parse(lastActivity) + timeout)`, where `timeout` is `waitingMs` if its current state is `waiting` and `idleMs` otherwise;
    - otherwise it drops at `nowMs`.

    Group the drop times by the `projectId` stored in `prevLive`.
  - **Freed brain**: `stateSince` = ISO of the latest drop time for its old project, or of `nowMs` if none.
  - **Brain that takes a project**: `base` = the latest `stateSince` (by `Date.parse`) among the project's live sessions whose `state` equals the brain's new state. If none has one, `base` = `nowMs`. On the first step (`prev.started === false`), `stateSince = base`. Otherwise it is the later of `base` and `nowMs`, which is in practice `nowMs`.
  - **Same project, state changed**: `stateSince` = the latest of: `base` as above; the project's drop times this step; and the brain's previous `stateSince`. If neither `base` nor any drop time exists, use `nowMs`.
  - **State and project unchanged**: keep `stateSince` (even if a second session changed).
  - **Output**: copy a session's `stateSince` string unchanged when it wins. Format computed times with `new Date(ms).toISOString()`. Free since start stays `null`.
  - Tests (`toStrictEqual` on whole brains):
    - First step, `a` working with `stateSince` 09:50 and last activity 10:25, `now` 10:30: MELCHIOR `stateSince` `"2026-10-18T09:50:00.000Z"`.
    - Later step, a new project `b` working with `stateSince` 10:20, `now` 10:30: BALTHASAR `stateSince` `iso("10:30")` (US3-7).
    - `a` working (single session) goes to standby with `stateSince` 10:28 at `now` 10:29: `stateSince` `iso("10:28")` (US3-5).
    - `a` working via X; Y in `a` also starts working (Y `stateSince` 10:29): `stateSince` unchanged (US3-6).
    - X `working` (last activity 09:00, `stateSince` 08:59) and Y `standby` (`stateSince` 09:30, last activity 10:20). Step at 09:10 shows `working`. Step at 09:40 (X live until 09:30 → dropped) shows `standby` with `stateSince` `iso("09:30")`, the drop time, which equals Y's `stateSince` in this case; vary Y's `stateSince` to 09:05 and expect `iso("09:30")`.
    - Brain freed by timeout: `a` standby last activity 10:00, steps at 10:20 then 10:45: MELCHIOR not-active with `stateSince` `iso("10:30")`.
    - Brain freed by session end (session removed) at `now` 10:40: `stateSince` `iso("10:40")`.
    - A brain never assigned stays `stateSince: null` across steps.
    - A brain that went `waiting` → `working` → `waiting` gets a new `stateSince` at each change, never earlier than the previous one.

**Checkpoint**: `/api/magi` shows correct state-since times.

---

## Phase 6: User Story 5 - Start MAGI without a repo path (Priority: P1)

**Goal**: `agent-visualizer` with no arguments; one path-less instance at `<state-root>/magi/server.json`; health without a repo.

**Independent Test**: `tests/state.test.ts`, `tests/args.test.ts`, `tests/server.test.ts` (health), `tests/cli.e2e.test.ts`.

- [ ] T011 [P] [US5] (tester → coder) Path-less instance record (`contracts/cli.md` "Instance record", research R1). Test file: `tests/state.test.ts` (add tests). Code: `src/server/state.ts`.
  - `InstanceRecord.repoPath: string | null`.
  - `instancePath(repoPath: string | null)`: `null` → `path.join(stateRoot(), "magi", "server.json")`; a string → unchanged.
  - `writeInstance`, `readInstance(repoPath: string | null)` and `removeInstance(repoPath: string | null, pid)` work for `null`.
  - `isInstanceRecord` accepts `repoPath` `string` or `null`.
  - `InstanceRunningError(repoPath: string | null, port)`: for `null` the message is exactly `Agent Visualizer is already running at http://127.0.0.1:<port>`; for a string it is unchanged.
  - Tests with a temp `AGENT_VISUALIZER_STATE_DIR`:
    - `instancePath(null)` equals `<tmp>/magi/server.json`;
    - write then read a `null` record round-trips with `repoPath: null`;
    - `removeInstance(null, otherPid)` keeps the file and `removeInstance(null, pid)` deletes it;
    - a `null` record and a repo record coexist without touching each other;
    - the `InstanceRunningError` message for `null` matches exactly.
- [ ] T012 [P] [US5] (tester → coder) Optional path in args (`contracts/cli.md` "Usage", research R8). Test file: `tests/args.test.ts` (change the "missing path" test, add tests). Code: `src/server/args.ts`.
  - `parseCliArgs([])` returns `{ repoPath: undefined, port: undefined, help: false, version: false }`.
  - `parseCliArgs(["--port", "5000"])` returns port 5000 with no path.
  - Two positionals still throw `UsageError`.
  - Update `usageText` to the "Usage" block of `contracts/cli.md`. Its first line must be `Usage: agent-visualizer [<repo-path>] [--port <n>]`. In the exit-code list, remove "missing <repo-path>" from code 2 and add "instance already running" (path-less) to code 1.
  - Tests assert the first usage line exactly and that `usageText` no longer contains `missing <repo-path>`.
- [ ] T013 [US5] (tester → coder) Nullable repo in routes and health (`contracts/http-api.md` "GET /api/health", research R7). Test file: `tests/server.test.ts` (add tests). Code: `src/server/routes.ts`, `src/server/start.ts`.
  - `HandlerOptions.repo` and `StartOptions.repo` become `RepoTarget | null`.
  - Health returns `repoPath: opts.repo?.path ?? null` and `repoName: opts.repo?.name ?? null`.
  - Tests: with `repo: null` the health body `toStrictEqual`s `{ status: "ok", repoPath: null, repoName: null, version, attentionHook: { seen: false, lastEventAt: null } }`; with a repo it is unchanged.
- [ ] T014 [US5] (tester → coder) CLI path-less start and UI fallback (`contracts/cli.md`, research R8). Test file: `tests/cli.e2e.test.ts` (add tests). Code: `src/cli/index.ts`, `src/web/App.tsx`.
  - `src/cli/index.ts`:
    - `const repo = options.repoPath === undefined ? null : await resolveRepoPath(options.repoPath)`;
    - `loadConfig(repo?.path)`;
    - `readInstance(repo?.path ?? null)`;
    - `InstanceRunningError(existing.repoPath, existing.port)`;
    - `writeInstance({ ..., repoPath: repo?.path ?? null })`;
    - `removeInstance(repo?.path ?? null, process.pid)` in both places;
    - pass `repo` to `startServer`;
    - print `Observing: all Claude Code projects` when `repo` is null, else `Observing: <path>` as before.
  - `src/web/App.tsx`: when `repoName` is null render `<h1>MAGI</h1>` and no path paragraph; otherwise unchanged.
  - Tests (spawn harness, temp state dir, empty transcripts dir, `cwd` = temp dir):
    - a no-argument start prints `Observing: all Claude Code projects` and a `Listening:` line;
    - `<state>/magi/server.json` exists with `"repoPath": null` and the process's pid;
    - `GET /api/health` has `repoPath: null` and `repoName: null`;
    - `GET /api/magi` returns three brains;
    - a second no-argument start exits `1`, and stderr contains exactly `Agent Visualizer is already running at http://127.0.0.1:<port>` with the first instance's port;
    - after `SIGINT` to the first instance it exits `0` and `magi/server.json` is gone;
    - a stale `magi/server.json` with a dead pid does not block a start;
    - `agent-visualizer.config.json` in `cwd` with `"idleTimeoutMinutes": 0` makes a no-argument start exit `1` with stderr containing `"idleTimeoutMinutes" must be a positive number of minutes`;
    - an existing with-path test still passes, showing the per-repo record is unchanged.

**Checkpoint**: MAGI starts with no arguments.

---

## Phase 7: User Story 4 - A fourth project waits its turn (Priority: P2)

**Goal**: queued projects are hidden; the most recently active queued project takes a freed brain; simultaneous activation is deterministic.

**Independent Test**: `describe("US4 queue")` in `tests/magi-slots.test.ts`.

- [ ] T015 [US4] (tester) Queue scenarios. Test file: `tests/magi-slots.test.ts` (add `describe("US4 queue")`). The code should already pass from T004 (research R4); if not, the planner sends the failures to a coder to fix `src/magi/slots.ts`.
  - `a`, `b`, `c` on 1–3; `d` becomes active: brains unchanged, and `d` appears in no brain (US4-1).
  - Queued `d` (last activity 10:05) and `e` (10:07); `b`'s only session is removed: `e` takes BALTHASAR, `d` stays hidden (US4-2).
  - Queued `d` times out before any brain frees; then `b` frees: BALTHASAR stays not-active (US4-3).
  - The brain list always has length 3 with numbers `[1, 2, 3]` and names in order (US4-4).
  - First step with `a`, `b`, `c`, `d` all active at once with activities 10:01, 10:04, 10:03, 10:02: MELCHIOR `b`, BALTHASAR `c`, CASPER `d`, and `a` is hidden.
  - Ties: `x` and `y` with identical activity: `/x/.git` sorts before `/y/.git`, so `x` gets the lower brain. Running the same step twice gives `toStrictEqual` results.
  - A brain freed and a new project activated in the same step compete with queued projects by activity: queued `d` (10:05) and new `f` (10:09) when `c` frees, so `f` takes CASPER.

**Checkpoint**: all user stories done.

---

## Phase 8: Polish, Documentation and PR

- [ ] T016 (coder) Documentation (Principle II). Files: `README.md`, `docs/master-spec.md`.
  - `README.md`:
    - Starting with no path (`bun run dev` / `agent-visualizer` with no argument). One path-less instance per machine; its record is at `~/.agent-visualizer/magi/server.json` (or under `AGENT_VISUALIZER_STATE_DIR`). The optional repo path only affects config lookup and the per-repo record.
    - `GET /api/magi` with the example from `contracts/http-api.md`.
    - The two config keys `idleTimeoutMinutes` (default 30) and `waitingTimeoutMinutes` (default 240) with what they mean.
    - Health `repoPath`/`repoName` may be `null`.
  - `docs/master-spec.md`:
    - In the State directory row, replace "the no-path MAGI instance's location is decided in 006" with `magi/server.json`.
    - In the Brains row, add the timeout rule: idle 30 min for working/standby, 4 h for waiting, both configurable; a crashed session stops counting after its timeout.
    - In the Transcript source paragraph, change "006's idle timeout" to "006's idle timeout (brain level)".
    - Add a short line on the brain `stateSince` rule (research R5) under Architecture.
    - Mark 004, 005 and 006 as *(shipped)* in "Feature specs" only if the planner says so at PR time; otherwise mark 006 only when merged.
  - Acceptance: `bun run verify` passes; every config key and the record path in the README match `contracts/cli.md`.
- [ ] T017 (planner) Live and dogfood check per `quickstart.md` "Manual (live)" and "Dogfood check":
  - no-path start;
  - this repo's Opus session on MELCHIOR going `working` ↔ `standby`;
  - a second project on BALTHASAR;
  - second-instance refusal;
  - `idleTimeoutMinutes: 0.5` freeing a brain;
  - the dead session `db3f06ca` not holding any brain.

  Record any spec gap found as a note in the PR. Fix only what the spec already requires.
- [ ] T018 (planner) Final `bun run verify` and `bun run build`. Push the branch and open the PR: summary, link to `specs/006-magi-slots/`, the docs updated, and the live-check result.

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3 → Phases 4–7 → Phase 8.
- Phase 2: T002 and T003 run in parallel (different files).
- Phase 3:
  - T004 needs T002.
  - T005 needs T004.
  - T006 needs T002 and T004 (`emptySlotState`).
  - T007 needs T003, T005 and T006.
- Phase 4: T008 needs T004. T009 needs T005 and may run in parallel with T008 (different files).
- Phase 5: T010 needs T004 and T008 (same test file; run after T008 so the two testers don't collide).
- Phase 6:
  - T011 and T012 run in parallel (different files) and need only Phase 2. They may also run alongside Phase 4/5 batches, as long as no other task in the batch touches their files.
  - T013 needs T006 (same files).
  - T014 needs T007, T011, T012 and T013.
- Phase 7: T015 needs T010 (same test file; its tests compare whole brains with `stateSince`, or leave it out).
- Phase 8: T016 after all code tasks; T017 after T016; T018 last.

### Parallel opportunities

- Batch A (Phase 2): T002 (coder) + T003 (tester, then coder).
- Batch B (after T005): T008 (tester) + T009 (tester) + T011 (tester → coder) + T012 (tester → coder). All four touch different files.
- Everything that edits `tests/magi-slots.test.ts` (T004, T008, T010, T015), `src/server/routes.ts` (T006, T013) or `tests/cli.e2e.test.ts` (T007, T014) runs one task at a time.

Parallel batches follow the "Parallel tasks" rules in `CLAUDE.md`: same checkout; parallel agents don't commit; the planner verifies once and commits each task in ID order with its box ticked.

## Implementation Strategy

1. **Foundation** (Phase 2): contract types and config keys.
2. **MVP** (Phase 3): slot core, service, `/api/magi`, CLI wiring. Stop and check `/api/magi` live against this repo's own session.
3. **Freeing** (Phase 4): timeout scenarios and the fixture test through the real transcript source.
4. **State-since** (Phase 5).
5. **Path-less start** (Phase 6). After this, `agent-visualizer` with no arguments is the normal way to run.
6. **Queue** (Phase 7): tests on the R4 rule.
7. **Docs, live check, PR** (Phase 8).
