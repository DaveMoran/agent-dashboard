---

description: "Task list for 005-attention-hook"
---

# Tasks: Attention Hook

**Input**: Design documents from `/specs/005-attention-hook/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (hook-events, agent-source, http-api), quickstart.md

**Tests**: Included. The spec requires fixture-driven tests (FR-018), and the constitution requires tests that fail when the behavior is removed (Principle V). Assert exact states, `stateSince` values, counts, event sequences and issue reasons. Use `toStrictEqual` wherever a field must be absent.

**Who does what** (constitution 1.4.0, `CLAUDE.md`):
- Tasks marked **(tester → coder)**: the `tester` agent first writes the named test files from the spec and contracts, without reading the implementation. The `coder` agent then implements until those tests pass, without changing them.
- Tasks marked **(tester)** are fixture or test-only work.
- Tasks marked **(coder)** are wiring or docs and go to a single coder.
- In every case the planner runs `bun run verify`, then commits tests, code and the ticked box together, one commit per task.

**Organization**: grouped by user story in spec order. US1 builds the core (hook-line classifier, combine function, attention source, CLI wiring). US2–US6 each add a slice on top. Complete the phases in order. [P] tasks touch different files and may run in parallel within their phase.

## Working rules

- Work only on branch `005-attention-hook`. Every commit subject ends with `[spec-005]`.
- Do not edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/` or the constitution. If a contract is wrong or ambiguous, stop and report.
- Read-only rules:
  - Nothing in `src/` writes to the events file, transcripts, observed repos or any Claude Code settings file.
  - Only `hooks/attention-hook.ts` writes the events file.
  - `scripts/hook-settings.ts` only prints.
- **No test may read `~/.claude` or `~/.agent-visualizer`.** Tests use temp dirs:
  - `AGENT_VISUALIZER_STATE_DIR` and `AGENT_VISUALIZER_TRANSCRIPTS_DIR` point at temp dirs.
  - Fixtures are copied first; nothing writes into `fixtures/`.
  - Git repos come from `tests/git-helpers.ts`.
- `src/contract/` imports nothing. `hooks/attention-hook.ts` imports only `node:fs`, `node:os` and `node:path`.
- Times in fixtures are ISO strings with milliseconds on 2026-10-15 (for example `2026-10-15T10:00:02.000Z`). In this file they are written as `10:00:02` for short.
- TypeScript strict, no new dependencies. Run `bun run verify` before ticking any task that changes code.

---

## Phase 1: Setup

- [ ] T001 (planner) Run `git branch --show-current` (expect `005-attention-hook`) and `bun run verify` (expect all existing tests to pass) to confirm a green baseline. No commit.

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: contract and interface types, the reducer's `lastTurnAt`, the transcript source's `clears()` and `onActivity()`, and the attention fixtures.

- [ ] T002 [P] (coder) In `src/contract/sessions.ts` change `SessionState` to `"working" | "standby" | "waiting"` (remove the "005 adds" comment). Create `src/contract/health.ts` exactly as in `contracts/http-api.md`: `export interface HealthResponse { status: "ok"; repoPath: string; repoName: string; version: string; attentionHook: { seen: boolean; lastEventAt: string | null } }`. Types only, no imports. `tests/contract-boundary.test.ts` already scans every file under `src/contract/`; it must still pass.
- [ ] T003 [P] (coder) In `src/agents/source.ts` add the variant `{ type: "session-ended"; sessionId: string; projectId: string; at: string }` to `AgentSourceEvent` (`contracts/agent-source.md`). Fix any exhaustive `switch` that no longer type-checks (none is expected; `bun run verify` must pass).
- [ ] T004 [P] (tester → coder) Reducer `lastTurnAt` (research R4). Test file: `tests/session-state.test.ts` (add tests). Code: `src/agents/transcripts/session-state.ts`.
  - Add `lastTurnAt: string | undefined` to `SessionStateT`. It is `undefined` in `initialSessionState()`.
  - In `applyEntry`, for every entry whose `kind` is not `"other"` and that has a timestamp, set `lastTurnAt` to the later of the old value and `entry.timestamp` (compare with `Date.parse`).
  - Tests:
    - a prompt at `10:00:00` then a tool call at `10:00:01` gives `lastTurnAt` `10:00:01`;
    - an `other` entry (for example `file-history-snapshot`) at `10:00:05` after that leaves `lastTurnAt` at `10:00:01` but moves `lastActivity` to `10:00:05`;
    - each of `tool-result`, `progress`, `final`, `turn-end`, `interrupt` and `session-end` moves it;
    - an older timestamp does not move it back;
    - the input is not mutated.
- [ ] T005 (tester → coder) Transcript source extras (`contracts/agent-source.md`, "Transcript source additions"). Test file: `tests/transcript-source.test.ts` (add tests). Code: `src/agents/transcripts/source.ts`.
  - Export `interface AgentClears { main: string | undefined; subagents: Record<string, string | undefined>; lastTurnAt: string | undefined }`.
  - Add to the factory's return type:
    - `clears(sessionId: string): AgentClears | undefined`. For the visible record with that session ID, `main` is the main track's `lastTurnAt`. `subagents[id]` is the later of that subagent track's `lastTurnAt` and `main.state.completedAgentIds[id]`. `lastTurnAt` is the max over the main and all subagent `lastTurnAt` values. Returns `undefined` for an unknown session ID.
    - `onActivity(listener: (sessionId: string) => void): () => void`. After each pass, call each listener once with the session ID of every announced, visible record whose main or subagent tracks folded at least one new line in that pass (each listener in its own `try/catch`). The returned function unsubscribes. Nothing is called after `stop()`.
  - Tests use the 004 fixtures:
    - `tool-calls`: `clears("22222222-2222-2222-2222-222222222222")` has `main` equal to the timestamp of its last line and `subagents` `{}`.
    - `background-subagents`: `subagents` has exactly the three agent IDs. Agent 2's value is the notification's timestamp (later than its own last line). `lastTurnAt` is the max.
    - `clears("nope")` is `undefined`.
    - An `onActivity` listener receives the session ID exactly once after appending two lines to one session and calling `refresh()`, and nothing after a `refresh()` with no new lines.
    - Appending only to a subagent file still reports the parent's session ID.
    - Nothing is received after unsubscribing.
- [ ] T006 [P] (tester) Attention fixtures and helper (research R11). Fixtures: `fixtures/attention/<scenario>/projects/-repo/<session>.jsonl` (plus `<session>/subagents/agent-<id>.jsonl` where listed) and `fixtures/attention/<scenario>/events.jsonl`. Helper: `tests/attention-fixtures.ts`.
  - **Transcript lines**: use the 004 shapes (`specs/004-session-ingester/contracts/transcript-format.md`, existing `fixtures/transcripts/`). Every session has `cwd` `{{REPO}}`. Assistant lines use model `claude-opus-5-5` in main transcripts and `claude-sonnet-5-5` in subagent transcripts.
  - **Event lines**: follow `contracts/hook-events.md`, with `"cwd":"{{REPO}}"`.
  - **Session IDs**: `a0050000-0000-0000-0000-0000000000NN`, where `NN` is the scenario number below.
  - Scenarios:
    1. `permission-main/` (S01). Transcript:
       - `10:00:00` prompt
       - `10:00:01` `tool_use` `tu1` name `Bash` (`stop_reason: "tool_use"`)
       - `10:00:10` `tool_result` `tu1`
       - `10:00:11` `text` `end_turn`
       - `10:00:11.500` `turn_duration`

       Events: `PermissionRequest` type `Bash` at `10:00:02`.
    2. `question-main/` (S02). Transcript:
       - `10:00:00` prompt
       - `10:00:01` `tool_use` `tu1` name `AskUserQuestion`
       - `10:00:20.050` `tool_result` `tu1`
       - `10:00:21` `text` `end_turn`
       - `10:00:21.500` `turn_duration`

       Events: `PreToolUse` type `Bash` at `10:00:00.500` (ignored); `PreToolUse` type `AskUserQuestion` at `10:00:01.200`; `PostToolUse` type `AskUserQuestion` at `10:00:20`.
    3. `interrupted-wait/` (S03). Transcript:
       - `10:00:00` prompt
       - `10:00:01` `tool_use` `tu1` `Bash`
       - `10:00:05` user text `[Request interrupted by user for tool use]`

       Events: `PermissionRequest` `Bash` at `10:00:02`.
    4. `subagent-wait/` (S04).
       - Main transcript:
         - `10:00:00` prompt
         - `10:00:01` two `Agent` `tool_use` lines `tu1`, `tu2`
         - `10:00:02` `tool_result` `tu1` and `tool_result` `tu2` (content `"Async agent launched"`)
         - `10:00:03` `text` `end_turn`
         - `10:00:03.500` `turn_duration`
       - Subagent `a0000000000000041` (busy):
         - `10:00:02.500` prompt
         - `tool_use`/`tool_result` pairs at `10:00:05`/`10:00:06`, `10:00:07`/`10:00:08`, `10:00:09`/`10:00:10`
         - `10:00:30` `text` `end_turn`
       - Subagent `a0000000000000042` (asks):
         - `10:00:02.500` prompt
         - `10:00:04` `tool_use` `s1` `Bash`
         - `10:00:20` `tool_result` `s1`
         - `10:00:21` `text` `end_turn`
       - Events: `PermissionRequest` `Bash` agent `a0000000000000042` at `10:00:04.500`; `SubagentStop` agent `a0000000000000042` at `10:00:21.100`; `SubagentStop` agent `a0000000000000041` at `10:00:30.100`.
    5. `main-wait-bg-subagent/` (S05).
       - Main transcript:
         - `10:00:00` prompt
         - `10:00:01` `Agent` `tool_use` `tu1`
         - `10:00:02` its `tool_result` (`"Async agent launched"`)
         - `10:00:03` `tool_use` `tu2` `Bash`
         - `10:00:15` `tool_result` `tu2`
         - `10:00:16` `text` `end_turn`
         - `10:00:16.500` `turn_duration`
       - Subagent `a0000000000000051`:
         - `10:00:02.500` prompt
         - `tool_use`/`tool_result` pairs at `10:00:05`/`10:00:06` and `10:00:07`/`10:00:08`
         - no final reply
       - Events: `PermissionRequest` `Bash` (no agent) at `10:00:03.500`.
    6. `unsorted-events/` (S06, S07). Each transcript: `10:00:00` prompt, `10:00:01` `tool_use` `tu1` `Bash`. Event lines, in this file order:
       - S06 `Stop` `10:00:09`
       - S06 `PermissionRequest` `Bash` `10:00:08`
       - S07 `PermissionRequest` `Bash` `10:00:05`
       - S07 `UserPromptSubmit` `10:00:01`
    7. `session-end/` (S08, S09).
       - S08 transcript:
         - `10:00:00` prompt
         - `10:00:01` `text` `end_turn`
         - `10:00:01.500` `turn_duration`
         - `10:00:12` `file-history-snapshot` (bookkeeping, kind `other`)
       - S09 transcript:
         - `10:00:00` prompt
         - `10:00:05` `text` `end_turn`
       - Events: S08 `Stop` at `10:00:01.200`; S08 `SessionEnd` type `prompt_input_exit` at `10:00:10`; S09 `SessionEnd` type `other` at `10:00:03`.
    8. `late-session/` (S10). `projects/-repo/` is empty (keep a `.gitkeep`). `later/-repo/a0050000-0000-0000-0000-000000000010.jsonl` holds `10:00:00` prompt and `10:00:01` `tool_use` `tu1` `Bash`. Events: `PermissionRequest` `Bash` at `10:00:02`.
    9. `malformed-events/` (S11). Transcript: `10:00:00` prompt, `10:00:01` `tool_use` `tu1` `Bash`. Event lines, in order:
       - `{not json`
       - `[1]`
       - `{"ts":"2026-10-15T10:00:02.000Z","event":"PermissionRequest"}` (no session)
       - `{"ts":"nope","session":"<S11>","event":"PermissionRequest"}`
       - a valid S11 `PermissionRequest` `Bash` at `10:00:03`
       - a valid S11 `UserPromptSubmit` at `10:00:04` **without a trailing newline**
  - In `tests/attention-fixtures.ts` export:
    - `materializeAttention(scenario: string, vars: Record<string, string>): Promise<{ dir: string; transcriptsRoot: string; eventsFile: string }>`. It copies `fixtures/attention/<scenario>/` with `copyFixture` from `tests/helpers.ts` and fills `{{NAME}}` placeholders in every `.jsonl` exactly as `materializeTranscripts` does (factor the replacement into an exported `fillPlaceholders(root, vars)` in `tests/transcript-fixtures.ts` and use it from both). It returns `transcriptsRoot` = `<dir>/projects` and `eventsFile` = `<dir>/events.jsonl`.
    - `scenarioLines(dir: string): { file: string; text: string; ts: string }[]`. Every non-empty line of every `.jsonl` under `<dir>/projects` and of `<dir>/events.jsonl`, sorted by `ts` (the line's `timestamp` or `ts` field), then by file path and line order.
    - `emptyCopy(dir: string): void`. Truncates every such file to 0 bytes, so a test can replay lines in any order with `appendLine`.
  - Write `fixtures/attention/README.md` listing each scenario, its sessions and its expected final state:
    - S01 `standby`
    - S02 `standby`
    - S03 `standby`
    - S04 `standby`, 0 running subagents
    - S05 `working`, 1 running subagent
    - S06 `working`
    - S07 `waiting` since `10:00:05`
    - S08 not listed (ended)
    - S09 `standby`
    - S10 `waiting` since `10:00:02` once its transcript is moved in within the hold time
    - S11 `working` after the partial line is completed

    Add `tests/attention-fixtures.test.ts`: materializing `permission-main` replaces `{{REPO}}`; `scenarioLines` returns the 6 lines in timestamp order; `emptyCopy` leaves every file at 0 bytes; the checked-in fixtures are unchanged.

**Checkpoint**: types compile, `lastTurnAt`, `clears()` and `onActivity()` are tested, and the fixtures exist.

---

## Phase 3: User Story 1 - See when a main agent is waiting for me (Priority: P1) 🎯 MVP

**Goal**: `waiting` from hook events, scoped per agent, through `/api/sessions`.

**Independent Test**: `tests/attention-combine.test.ts` (pure) and `tests/attention-source.test.ts` on scenarios 1–5 in timestamp order.

- [ ] T007 [US1] (tester → coder) Hook line classifier. Test file: `tests/hook-line.test.ts`. Code: `src/agents/attention/hook-line.ts`.
  - Implement `classifyHookLine(text: string): { event: HookEvent } | { issue: { reason: "invalid-json" | "not-an-object" | "missing-field"; field?: string } }` exactly per `contracts/hook-events.md` "Reader classification".
  - Export `type HookMeaning = "wait-start" | "wait-end" | "session-end" | "ignored"`.
  - Export `interface HookEvent { ts: string; sessionId: string; cwd: string | undefined; event: string; type: string | undefined; agentId: string | undefined; meaning: HookMeaning; agentKey: string }`.
  - Export `MAPPED_EVENTS: readonly string[]`, the event names that can have a meaning other than `ignored`, sorted.
  - `agentKey` is `agentId ?? ""`, except `SubagentStop` without `agent`, which is `ignored`.
  - Tests: one per row of the mapping table, including:
    - `PreToolUse` with type `Bash` is `ignored`;
    - `PreToolUse` with type `ExitPlanMode` is `wait-start`;
    - `PermissionRequest` with `agent` gives that `agentKey`;
    - `UserPromptSubmit` with an `agent` field still has `agentKey` `""`;
    - an unknown event is `ignored`.
  - Also each issue case with its `field`, and an exact key-set check on `HookEvent`.
- [ ] T008 [US1] (tester → coder) Pure combine. Test file: `tests/attention-combine.test.ts`. Code: `src/agents/attention/combine.ts`. Implement `data-model.md` "AttentionRecord" and "Combined state", with the maps as plain records:
  - `interface AttentionRecord { waitAt: Record<string, string>; hookClearAt: Record<string, string>; endAt: string | undefined; lastHookAt: string | undefined; newestAt: string | undefined }`
  - `emptyRecord()`
  - `applyHookEvent(record, event: HookEvent): AttentionRecord`, which is pure and keeps maxima:
    - `wait-start` updates `waitAt[agentKey]`;
    - `wait-end` updates `hookClearAt[agentKey]`;
    - `session-end` updates `endAt`;
    - every event except `session-end` updates `lastHookAt`, including `ignored`;
    - every event updates `newestAt`.
  - `waitingAgents(record, clears: AgentClears | undefined): string[]` (sorted). Agent `k` is waiting when `waitAt[k]` is later than both `hookClearAt[k]` and the agent's transcript clear (`clears.main` for `""`, `clears.subagents[k]` otherwise). A tie is not waiting, and `undefined` clears count as never.
  - `waitSince(record, clears): string | undefined`, the latest `waitAt` among waiting agents.
  - `isEnded(record, clears): boolean`, which is `endAt` later than both `clears?.lastTurnAt` and `lastHookAt`.
  - `combinedState(base: SessionState, record, clears): SessionState`, which is `"waiting"` if any agent is waiting, else `base`.

  Tests:
  - US1 scenarios 1–6 as tables;
  - a tie is not waiting;
  - a main wait is not ended by a subagent clear;
  - a subagent wait is not ended by `clears.main` or another subagent's clear (spec FR-008);
  - two subagents waiting, one cleared: still waiting;
  - applying the same events in reversed order gives a deep-equal record (FR-010);
  - `isEnded` false when a later turn or a later hook event exists;
  - the input record is not mutated.
- [ ] T009 [US1] (tester → coder) The attention source per `contracts/agent-source.md`. Test file: `tests/attention-source.test.ts`. Code: `src/agents/attention/source.ts`.
  - Factory: `createAttentionSource({ base, eventsFile, pollIntervalMs = 500, holdMs = 600_000, now = Date.now })`, returning `AgentSource & { refresh(): Promise<void>; hookStatus(): HookStatus }` (export `HookStatus`).
  - **Reading**: tail `eventsFile` with `FileTail` from `src/agents/transcripts/tail.ts`. A missing file means no lines and no issue. Classify each line with `classifyHookLine` and fold it into a per-session `AttentionRecord` with `applyHookEvent`. Classification issues become `IngestIssue`s (`file` = `eventsFile`, `offset` = the line's offset, `detail` = `field`).
  - **Recomputing**: after each events pass, recompute every session whose record changed. On each `base.onActivity(id)`, recompute `id`.
    - `state = combinedState(baseSession.state, record, base.clears(id))`.
    - When the state changes, `stateSince` is the `ts` of the hook event or the transcript time that caused the change (for a transcript-caused change use `base.clears(id)?.lastTurnAt`, or the base event's `at`). When the combined state equals the base state and was not changed by a hook, `stateSince` is the base's `stateSince`.
    - Emit `state-changed` exactly once per actual change, with the combined session.
  - **Passing base events through**: re-emit base events with the combined `state`/`stateSince` substituted into `session`. A base `state-changed` whose combined `from`/`to` are equal is dropped, and one whose combined values differ is emitted with them.
  - **Lifecycle**: `sessions()` maps the base sessions the same way. `start()` starts the base, then reads the whole events file once, then polls when `pollIntervalMs > 0`. `stop()` stops the timer, then the base. `issues()` is the base's issues followed by its own, at most 200.
  - Leave session end and the hold timeout to T016/T012. In this task an ended record has no effect.
  - Tests:
    - Build a real transcript source (`createTranscriptSource` with `pollIntervalMs: 0` and the materialized `transcriptsRoot`) and an attention source over it with `pollIntervalMs: 0` and `now: () => Date.parse("2026-10-15T10:01:00.000Z")`. Fixture times are in the past, so the default `Date.now` would trip the hold timeout.
    - Use `emptyCopy` and replay `scenarioLines` in timestamp order with `appendLine`, calling `base.refresh()` then `attention.refresh()` after each line.
    - Assert the exact sequence of `state-changed` `(to, at)` pairs and the final session:
      - S01: `working@10:00:00`, `waiting@10:00:02`, `working@10:00:10`, `standby@10:00:11`.
      - S02: `working@10:00:00`, `waiting@10:00:01.200`, `working@10:00:20`, `standby@10:00:21`.
      - S03: `working@10:00:00`, `waiting@10:00:02`, `standby@10:00:05`.
      - S04: `waiting@10:00:04.500` stays through the busy subagent's `10:00:05`–`10:00:10` entries with `runningSubagents: 2`, then `working@10:00:20`, then `standby@10:00:30`.
      - S05: `waiting@10:00:03.500` with `runningSubagents: 1` stays through the subagent's entries, then `working@10:00:15`, and ends `working` with 1 running subagent.
    - `sessions()` while waiting reports `state: "waiting"` and `stateSince` equal to the wait's `ts`.
    - A listener unsubscribed gets nothing.
    - After `stop()` nothing is emitted.
    - Fixture files are byte-identical afterwards (copy-first is verified by checksumming `fixtures/attention/`).
- [ ] T010 [US1] (coder) Wire it in.
  - `src/cli/index.ts`: create the transcript source as now, then `createAttentionSource({ base: transcripts, eventsFile: path.join(stateRoot(), "hooks", "events.jsonl") })`. Start and stop the attention source, which starts and stops the base, instead of the transcript source. Pass it as `agentSource`.
  - `tests/sessions-api.test.ts`: add a test where a stub session with `state: "waiting"` appears in the response with `state: "waiting"`.
  - `tests/cli.e2e.test.ts`: add a test with temp `AGENT_VISUALIZER_STATE_DIR` and `AGENT_VISUALIZER_TRANSCRIPTS_DIR`, materialized `permission-main` lines up to `10:00:01` in the transcript, and the `PermissionRequest` line in `<state>/hooks/events.jsonl`. `GET /api/sessions` lists S01 with `state: "waiting"` (poll up to 2 s).

**Checkpoint**: a permission prompt shows as `waiting` end to end.

---

## Phase 4: User Story 2 - Events that arrive out of order (Priority: P1)

**Goal**: the same answer in any read order, and events for not-yet-known sessions held.

**Independent Test**: `tests/attention-source.test.ts` read-order tests.

- [ ] T011 [US2] (tester → coder) Read-order tests (FR-010, SC-002). Test file: `tests/attention-source.test.ts`. Code: fix `src/agents/attention/source.ts` or `src/agents/attention/combine.ts` only if a test fails.
  - Replay scenarios 1–7 under three orders:
    - `ts`: timestamp order, one line at a time;
    - `transcripts-first`: all transcript lines, then all event lines;
    - `events-first`: all event lines, then all transcript lines.
  - Call both `refresh()`s after each line. Use `now: () => Date.parse("2026-10-15T10:01:00.000Z")`, so events read before their session are held, not dropped.
  - The final `sessions()` projected to `{ sessionId, state, runningSubagents }` (sorted by ID) is identical across the three orders and equals the README's expected final states.
  - Under `transcripts-first`, S01, S02 and S03 never emit a `state-changed` with `to: "waiting"` (US2 scenario 1).
  - S07 in `unsorted-events` is `waiting` with `stateSince` `10:00:05`, and S06 is not waiting (US2 scenario 3).
- [ ] T012 [US2] (tester → coder) Unknown sessions and the hold timeout (FR-011, research R7). Test file: `tests/attention-source.test.ts`. Code: `src/agents/attention/source.ts`.
  - Records for session IDs the base does not report are kept, and applied when the base announces the session (on `session-added`, recompute).
  - On each events pass, drop records whose session is unknown to the base and whose `now() - Date.parse(newestAt) > holdMs`.
  - Hook events never add sessions to `sessions()`.
  - Tests with `late-session`:
    - after the first refresh `sessions()` is `[]`;
    - with `now` = `10:05:00`, moving `later/-repo/` into `projects/` and refreshing both gives S10 `waiting` since `10:00:02` (US2 scenario 4);
    - with `now` = `10:20:00` before the move, S10 is `working` after the move (dropped).
  - Also a wait whose transcript tool result is already in the moved file (append a `tool_result` `tu1` at `10:00:03` before moving) is not `waiting`.

---

## Phase 5: User Story 3 - Install the hook myself, safely (Priority: P1)

**Goal**: the hook script and the settings printer.

**Independent Test**: `tests/hook-script.test.ts` and `tests/hook-settings.test.ts`.

- [ ] T013 [P] [US3] (tester → coder) The hook script per `contracts/hook-events.md` and research R3. Test file: `tests/hook-script.test.ts`. Code: `hooks/attention-hook.ts`.
  - The script reads all of stdin, builds `{ ts, session, cwd?, event, type?, agent? }` (`type` from the first present of `notification_type`, `tool_name`, `reason`), creates `<root>/hooks` with `{ recursive: true, mode: 0o700 }`, and appends `JSON.stringify(line) + "\n"` with one `appendFileSync`.
  - `<root>` is `process.env.AGENT_VISUALIZER_STATE_DIR || path.join(os.homedir(), ".agent-visualizer")`.
  - The whole body is in `try/catch`. It never writes to stdout or stderr and always exits 0.
  - Tests spawn `bun hooks/attention-hook.ts` with `Bun.spawn`, stdin from a string and `AGENT_VISUALIZER_STATE_DIR` set to a temp dir. Cases:
    - a `PermissionRequest` input with `tool_name`, `tool_input`, `permission_suggestions` and `prompt_id` gives exactly one line whose keys are `["agent"?, "cwd", "event", "session", "ts", "type"]` (no `tool_input` or other fields) and whose `ts` parses and is within 5 s of now;
    - a `UserPromptSubmit` input with `prompt: "secret text"` writes a line that does not contain `secret text` and has no `type`;
    - a `SessionEnd` with `reason: "logout"` has `type: "logout"`;
    - a subagent input with `agent_id` has `agent`;
    - a missing state dir is created;
    - invalid JSON stdin, and an input without `session_id`, write nothing;
    - a state dir that is a read-only directory (chmod `0o500`) writes nothing.
  - In every case stdout and stderr are empty and the exit code is 0.
  - 10 concurrent spawns give 10 complete, parseable lines.
  - The script's source imports only `node:fs`, `node:os` and `node:path` (read the file and check its import specifiers).
  - The path it writes equals `path.join(stateRoot(), "hooks", "events.jsonl")` from `src/server/state.ts` for the same env.
- [ ] T014 [US3] (tester → coder) Settings snippet. Test file: `tests/hook-settings.test.ts`. Code: `src/agents/attention/settings.ts`, `scripts/hook-settings.ts` and a `"hook-settings": "bun scripts/hook-settings.ts"` script in `package.json`.
  - `settings.ts` exports `HOOK_REGISTRATIONS: readonly { event: string; matcher?: string; async: boolean }[]` with exactly the rows of the snippet in `contracts/hook-events.md`.
  - It also exports `buildHookSettings(bunPath: string, scriptPath: string): { hooks: Record<string, { matcher?: string; hooks: { type: "command"; command: string; async?: true }[] }[]> }`, producing that snippet with `command` = `` `${bunPath} ${scriptPath}` `` (quote either path with double quotes if it contains a space).
  - `scripts/hook-settings.ts` prints `JSON.stringify(buildHookSettings(process.execPath, <absolute path of hooks/attention-hook.ts>), null, 2)` and writes no file.
  - Tests:
    - the set of `event` names equals `MAPPED_EVENTS` from T007;
    - exactly `PermissionRequest`, `PreToolUse`, `Elicitation` and `SessionEnd` are not async;
    - `PreToolUse`, `PostToolUse` and `PostToolUseFailure` have matcher `AskUserQuestion|ExitPlanMode` and the others have none;
    - the output deep-equals the contract snippet with `<BUN>`/`<REPO>` substituted;
    - a path with a space is quoted;
    - running `bun scripts/hook-settings.ts` prints JSON whose commands contain absolute paths ending `hooks/attention-hook.ts`, and creates no file in a temp cwd.

---

## Phase 6: User Story 4 - Without the hook, nothing changes (Priority: P1)

**Independent Test**: `tests/attention-source.test.ts` no-file and replaced-file tests.

- [ ] T015 [US4] (tester → coder) Missing, appearing and replaced events files (FR-006, FR-016, research R9). Test file: `tests/attention-source.test.ts`. Code: fix `src/agents/attention/source.ts` only if a test fails.
  - For each 004 scenario in `fixtures/transcripts/` (materialized as in `tests/transcript-source.test.ts`) and no events file: the attention source's `sessions()` deep-equals the transcript source's, every emitted event deep-equals the base's in the same order, `issues()` equals the base's, and `hookStatus()` is `{ seen: false, lastEventAt: null }` (US4 scenario 1, SC-005).
  - Creating the events file with `permission-main`'s event after start, then `refresh()`, makes S01 `waiting` (scenario 2).
  - Replacing the file with a shorter one that has only a `UserPromptSubmit` line for another session, then `refresh()`, raises no issue and leaves S01 `waiting` (scenario 3).
  - Deleting the file raises no issue.

---

## Phase 7: User Story 5 - Sessions that end (Priority: P2)

**Independent Test**: `tests/attention-source.test.ts` with `session-end`.

- [ ] T016 [US5] (tester → coder) Session end and revival (FR-012, research R8). Test file: `tests/attention-source.test.ts`. Code: `src/agents/attention/source.ts`.
  - A session whose `isEnded(record, base.clears(id))` is true is left out of `sessions()`.
  - On the change to ended, emit `{ type: "session-ended", sessionId, projectId, at: record.endAt }` once, and drop base events for it while ended.
  - When it stops being ended, emit `session-added` with the combined session.
  - Tests with `session-end` in timestamp order:
    - S08 emits one `session-ended` at `10:00:10` and is absent from `sessions()` after the `10:00:12` bookkeeping line (no revival by `other` entries);
    - S09 stays listed as `standby` (end earlier than its last turn, US5 scenario 3);
    - appending a prompt at `10:05:00` to S08 and refreshing emits `session-added` with `state: "working"`, and S08 is listed again (scenario 2);
    - `/api/sessions` built from `sessions()` with `buildSessionsResponse` has no S08 while it is ended (scenario 4: a project whose only session ended is absent).

---

## Phase 8: User Story 6 - Check that the hook is working (Priority: P3)

- [ ] T017 [US6] (tester → coder) Health status (FR-015, `contracts/http-api.md`). Test files: `tests/server.test.ts` (update the exact-body test, add one) and `tests/attention-source.test.ts` (add). Code: `src/agents/attention/source.ts` (`hookStatus()`), `src/server/routes.ts`, `src/server/start.ts`, `src/cli/index.ts`.
  - `hookStatus()` returns `seen: true` and `lastEventAt` = the max `ts` of valid lines once any valid line has been read, else `{ seen: false, lastEventAt: null }`. Invalid lines don't count.
  - `HandlerOptions` and `StartOptions` gain `hookStatus?: () => HookStatus`. The health body is typed `HealthResponse` and adds `attentionHook: opts.hookStatus?.() ?? { seen: false, lastEventAt: null }`.
  - The CLI passes `attention.hookStatus`.
  - Tests:
    - the existing exact-body test now includes `attentionHook: { seen: false, lastEventAt: null }`;
    - a server with a `hookStatus` returning `{ seen: true, lastEventAt: "2026-10-15T10:00:02.000Z" }` returns it;
    - the source, after `malformed-events`, reports `lastEventAt` `10:00:03` (the valid line), and after completing the partial line reports `10:00:04`;
    - `issues()` lists exactly the four expected issues in offset order.

---

## Phase 9: Polish, Documentation and PR

- [ ] T018 (coder) Documentation (Principle II, FR-017).
  - `README.md`, new section "Attention hook (optional)":
    - what it does (red/`waiting` for permission prompts, questions, plan approval);
    - that the visualizer never edits your settings;
    - run `bun run hook-settings` and paste the output into `~/.claude/settings.json`, merging with existing `hooks`;
    - the events file location `~/.agent-visualizer/hooks/events.jsonl` (or `$AGENT_VISUALIZER_STATE_DIR/hooks/`), what a line contains, that it holds no prompt text or tool input, and that it can be deleted at any time;
    - how to check it works (`curl /api/health` → `attentionHook.seen`);
    - how to remove it (delete those hook entries);
    - that idle notifications do not count as waiting.
  - `README.md`, "HTTP API": `waiting` in `/api/sessions`, ended sessions not listed, and `attentionHook` in `/api/health`.
  - `README.md`, "Project structure": `hooks/`, `src/agents/attention/`, `src/contract/health.ts`, `scripts/hook-settings.ts`.
  - `docs/master-spec.md`: the hook event mapping table (research R1), the per-agent wait rule (FR-008), and the sync/async split (R3).
  - Check every command in the README runs as written.
- [ ] T019 (planner) Run `bun run verify` and `bun run build`. Then do the quickstart section 3 live dogfood check:
  - install the hook from `bun run hook-settings` into the user's own settings, with the user's go-ahead (the user edits or approves the edit);
  - check permission, `AskUserQuestion`, a background-subagent permission while another subagent works, idle stays `standby`, `/exit` removes the session and resuming brings it back;
  - check `events.jsonl` holds no prompt text.

  Report results in the reply. Anything found becomes a follow-up task with its tests.

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3 → Phases 4–8 → Phase 9.
- In Phase 2, T002, T003, T004 and T006 can run in parallel. T005 needs T004.
- T007 → T008 → T009 → T010. T009 needs T005 and T006.
- T011 and T012 need T009. T015, T016 and T017 need T009 and all touch `tests/attention-source.test.ts` and `src/agents/attention/source.ts`, so they run one at a time in ID order (T011, T012, T015, T016, T017).
- T013 needs nothing but Phase 1 and may run in parallel with any batch. T014 needs T007.
- T018 after T017, then T019 last.

### Parallel opportunities

- Batch A (Phase 2): T002 + T003 + T004 + T006 (different files). T006 goes to a tester and the rest to coders. The T004 tester runs first, then its coder.
- Batch B: T013 alongside T007 or T008 (`hooks/attention-hook.ts` and its test touch nothing else).
- Everything else runs one task at a time.

Parallel batches follow the "Parallel tasks" rules in `CLAUDE.md`: same checkout; parallel agents don't commit; the planner verifies once and commits each task in ID order with its box ticked.

## Implementation Strategy

1. **Foundation** (Phase 2): types, `lastTurnAt`, `clears()`/`onActivity()`, fixtures.
2. **MVP** (Phase 3): hook lines → per-agent combine → attention source → CLI. A hand-written events line makes a session red end to end.
3. **Robustness** (Phases 4, 6): read order, late sessions, missing or replaced file.
4. **Install path** (Phase 5): the real hook script and the settings printer. This is the first point where Claude Code itself produces events.
5. **End and health** (Phases 7, 8).
6. **Docs and live dogfood** (Phase 9), then open the PR.
