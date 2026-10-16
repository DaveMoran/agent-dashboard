# Research: Attention Hook

Sources: the Claude Code hooks reference (code.claude.com/docs/en/hooks, read 2026-10-15), and two headless probe runs with Claude Code 2.1.301 (`claude -p --settings <probe>.json`). The probe logged each hook's raw standard input to a scratch file, and only the field names and IDs were inspected. The probe transcripts were deleted afterwards. User-level settings were not touched.

## R1. Which hook events mean what (the mapping, FR-005)

**Decision**: the documented settings subscribe to exactly these events:

| Hook event | Matcher | Meaning | Belongs to |
|---|---|---|---|
| `PermissionRequest` | (all tools) | wait starts | `agent_id` if present, else main |
| `PreToolUse` | `AskUserQuestion\|ExitPlanMode` | wait starts | `agent_id` if present, else main |
| `Elicitation` | (all) | wait starts | `agent_id` if present, else main |
| `PostToolUse`, `PostToolUseFailure` | `AskUserQuestion\|ExitPlanMode` | wait ends | `agent_id` if present, else main |
| `ElicitationResult` | (all) | wait ends | `agent_id` if present, else main |
| `UserPromptSubmit` | — | wait ends | main |
| `Stop`, `StopFailure` | — | wait ends | main |
| `SubagentStop` | — | wait ends | the subagent (`agent_id`) |
| `SessionEnd` | — | session ends | session |

Any other event name read from the file is ignored, so an older or hand-edited file does no harm.

**Rationale**:
- `PermissionRequest` "runs when Claude Code is about to ask you for permission to use a tool". It does not fire for calls that allow rules, auto mode or `--allowedTools` approve, so it marks exactly the prompts the user has to answer. Probe 2 saw it fire for a `Bash` call in the main agent (no `agent_id`) and for one inside a subagent (with `agent_id`).
- `AskUserQuestion` and `ExitPlanMode` are the tools that ask the user something (a question, plan approval). The docs present `PreToolUse` with these matchers as the place to intercept them. That event fires before the dialog is shown, and `PostToolUse` fires once it is answered. The answer also reaches the transcript as a tool result, which ends the wait on its own (R4). The `PostToolUse` hooks just end it sooner when the hook file is read first.
- `Elicitation` / `ElicitationResult` cover an MCP server asking the user for input. This is rare, but it is the same kind of wait.
- `Notification` is **not** used. Its `permission_prompt` type duplicates `PermissionRequest`. Its `idle_prompt` type comes after a turn has ended, which the spec defines as standby, not waiting. Its `agent_needs_input` type belongs to agent view and teams, which are outside V1. The docs also don't say whether a notification raised from a subagent carries `agent_id`. A subagent's wait wrongly attributed to the main agent could stay red until the next prompt, so leaving this event out is the safer choice.
- `Stop`, `StopFailure` and `UserPromptSubmit` end the main agent's turn or start a new one, and `SubagentStop` ends a subagent. The transcript gives the same signals (R4). The hook versions only make the end visible earlier.
- `SessionEnd` carries `reason` (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`). Every reason ends the session (FR-012).

**Alternatives considered**: `PreToolUse` on all tools as a "the agent is moving again" signal. It would run a process on every tool call, and the transcript already supplies that signal. `PermissionDenied` fires only in auto mode, when no prompt is shown, so it is not a wait.

## R2. Hook input fields (confirmed by probe)

Every event in the probes had `session_id`, `cwd`, `hook_event_name` and `transcript_path`. Other common fields (`prompt_id`, `permission_mode`, `effort`) were missing on `SessionStart`, so the script relies only on those three plus event-specific fields. Inside a subagent, every event (`PreToolUse`, `PermissionRequest`, `PostToolUse`, `SubagentStart`, `SubagentStop`) carried the **parent's** `session_id` plus `agent_id` and `agent_type`. The `agent_id` (for example `aabcc9e032d23a66b`) is exactly the `<id>` in the subagent transcript's file name `subagents/agent-<id>.jsonl`, which 004 already uses as the subagent's ID. The `type` the script records comes from `notification_type`, `tool_name`, `reason` (`SessionEnd`) or nothing, whichever is present.

**Decision**: one recorded line per event (contract: [contracts/hook-events.md](./contracts/hook-events.md)):
`{"ts":"2026-10-15T10:00:00.123Z","session":"<uuid>","cwd":"/path","event":"PermissionRequest","type":"Bash","agent":"aabcc9e032d23a66b"}`. `type` and `agent` are omitted when absent. Prompt text, tool input, messages and `last_assistant_message` are never written (FR-002).

## R3. The hook script: runtime, silence, speed

**Decision**: a standalone Bun script `hooks/attention-hook.ts`. It imports only `node:fs`, `node:os` and `node:path`, nothing from `src/`, so it starts fast and stays easy to read. It runs as `<bun> <repo>/hooks/attention-hook.ts`. It reads all of stdin, parses it, builds the line, creates `<state-root>/hooks/` with mode `0700` if missing, and appends with a single `fs.appendFileSync(file, line + "\n")` (flag `a`, so `O_APPEND`). The whole body is wrapped in `try/catch`. The script writes nothing to stdout or stderr and always exits 0. The state root is `AGENT_VISUALIZER_STATE_DIR`, or else `~/.agent-visualizer`, mirroring `stateRoot()` in `src/server/state.ts`. A test asserts the two agree.

- **Sync or async**: the wait-start hooks (`PermissionRequest`, `PreToolUse` on the question tools, `Elicitation`) run **synchronously**. Their timestamp must come before the answer that ends the wait, even when something answers instantly (another hook, an allow rule added mid-session). Otherwise an async line written after the tool result would leave the session red. The cost is one Bun start (about 20 to 40 ms) before a prompt the user must answer anyway. `SessionEnd` is also synchronous, because Claude Code may exit before a background hook runs, and its 1.5 s budget is plenty. The wait-end hooks (`PostToolUse`, `PostToolUseFailure`, `ElicitationResult`, `UserPromptSubmit`, `Stop`, `StopFailure`, `SubagentStop`) are `"async": true` and add no latency to a turn. A late clear cannot hide a newer wait, because no new wait can start within the few milliseconds of delay.
- **Silence**: with exit 0, a non-async `UserPromptSubmit` hook would add its stdout as context, and `PermissionRequest` and `PreToolUse` would parse it for a decision. Empty stdout with exit 0 makes no decision ("staying silent doesn't approve it"). An async hook's output isn't used at all. Writing nothing is safe in both cases (FR-003).
- **Interleaving**: each line is far below the size at which a local filesystem splits an `O_APPEND` write, so concurrent hooks write whole lines (FR-004).
- **Bun on PATH**: hooks run in a shell that may not have `~/.bun/bin` on `PATH`. A small helper `scripts/hook-settings.ts` (`bun run hook-settings`) prints the settings snippet with absolute paths (`process.execPath` and the script's resolved path) for the user to paste. It prints only; it writes no file (FR-001).

**Alternatives considered**: a POSIX shell script. It would need `jq` to parse JSON, and `jq` is not guaranteed to be installed. A `type: "http"` hook posting to the server would lose events while the visualizer is down, and would mean the server accepts writes. Both were rejected.

## R4. Ending waits from the transcript, per agent

**Decision**: the 004 reducer records a new value per transcript (the main transcript and each subagent's): `lastTurnAt`, the latest timestamp of any state-bearing entry (`prompt`, `tool-call`, `tool-result`, `progress`, `final`, `turn-end`, `interrupt`, `session-end`), meaning anything but `other`. Any such entry later than a wait ends it. A blocked agent writes no turn entries until the user answers, because the tool-call blocks of the waiting message are written before the hook fires, and the answer arrives as a tool result (allowed or denied) or an interrupt. Bookkeeping entries (`other`, such as a queued task notification arriving while the main agent waits) do not end a wait. For a subagent, its completion time from the parent's `completedAgentIds` also counts as a clear. The transcript source exposes these per session, without changing the `AgentSource` interface (contract: [contracts/agent-source.md](./contracts/agent-source.md)).

**Rationale**: a permission prompt's answer always reaches the agent's own transcript as a tool result (allowed or denied), and an Esc becomes an interrupt. Probe 2's denied calls were written as tool results in their own transcripts. Scoping by agent (spec FR-008) stops the steady stream of tool results from background subagents ending another agent's wait.

## R5. Combining: order independence (FR-010)

**Decision**: for each session and each agent key (`""` for the main agent, else the agent ID), keep `waitAt` (the max timestamp of wait-start hook events) and `hookClearAt` (the max timestamp of wait-end hook events). An agent is waiting when `waitAt > max(hookClearAt, transcriptClearAt)`, where `transcriptClearAt` is that agent's `lastTurnAt` (R4), or for a subagent the later of that and its completion time, where all times are compared as `Date.parse` values and a tie counts as cleared. The session is `waiting` when any of its agents is waiting. Otherwise it takes the transcript source's state.

**Rationale**: maxima are commutative, so the result depends only on the set of inputs read, not on their order. A wait that an earlier-read transcript entry already cleared can never turn red: the clear's timestamp is later, so the inequality fails whenever the hook line is read (spec US2). Treating ties as cleared errs toward "not red". Both timestamp sources are millisecond ISO times from the same clock.

**Alternatives considered**: a timeline replay that sorts every event. It gives the same answer with more state and code.

## R6. Recomputing when the transcript moves

The 004 source emits events only when a session's state or metadata changes. A tool result that leaves a session `working` emits nothing, yet it may end a wait. **Decision**: the transcript source gets one extra, transcript-specific method, `onActivity(listener)`. It calls the listener with a session ID after each pass in which that session's main or subagent transcript read new entries. The attention source recomputes that session then. The poll timer of the events file and the transcript poll are independent. Tests call `refresh()` on each and drive them in any order.

## R7. Unknown sessions and stale events (FR-011)

**Decision**: hook data is kept per session ID even when the transcript source doesn't know that session. Since hook events never create sessions, holding them costs nothing visible. On each pass, data for sessions that the transcript source doesn't know is dropped when its newest event is older than `holdMs` (default 10 minutes), measured with an injectable `now()`. At startup this also drops old events for sessions that no longer exist.

## R8. Session end and revival (FR-012)

**Decision**: `endAt` is the max timestamp of `SessionEnd` events. A session is ended when `endAt` is later than both its transcript `lastTurnAt` (the latest timestamp of any state-bearing entry: prompt, tool call, tool result, progress, final, turn-end, interrupt) and its newest non-end hook event. An ended session is left out of `sessions()`, and a `session-ended` event is emitted once. When a later turn entry or hook event arrives, it comes back with `session-added`.

**Rationale**: bookkeeping lines that Claude Code may write while shutting down (`last-prompt`, cost lines and similar) update last activity but are not turns, so they must not revive a closed session. That is why the rule uses `lastTurnAt` rather than last activity.

`AgentSourceEvent` gains `{ type: "session-ended"; sessionId; projectId; at }`. The only current consumer, `/api/sessions`, reads `sessions()` and needs no change. Brain slots (006) will handle the event.

## R9. Reading the events file

**Decision**: reuse 004's `FileTail` (byte offset, partial-line bytes, truncation or replacement detection) on `<state-root>/hooks/events.jsonl`, polled every 500 ms like transcripts. A missing file reads as no events (FR-006, FR-016). A truncated or replaced file is read from the start. Because waits are maxima over timestamps, re-reading lines is harmless, and waits already recorded stay until something ends them (spec US4 scenario 3). Lines that are not JSON objects, or that lack `ts`, `session` or `event`, become `IngestIssue`s using the existing reasons (`invalid-json`, `not-an-object`, `missing-field`).

## R10. Health and contract

**Decision**: `SessionState` in `src/contract/sessions.ts` gains `"waiting"`. A new `src/contract/health.ts` types the existing health response and adds `attentionHook: { seen: boolean; lastEventAt: string | null }`, where `seen` is true once any valid hook line has been read, ever, by this process (FR-015). The handler takes an optional `hookStatus()` provider, and without one it reports `seen: false`.

## R11. Fixtures and tests

**Decision**: scenario folders under `fixtures/attention/<scenario>/` each hold a `projects/` tree in the 004 transcript layout (using 004's placeholders and helper) and an `events.jsonl`. Tests copy a scenario into a temp root and a temp state directory. The out-of-order tests run each scenario under every interleaving of "read transcripts" and "read events" passes, line by line where the scenario needs it, and assert identical final states (SC-002). The hook-script test runs the script with `Bun.spawn` against sample stdin and a temp `AGENT_VISUALIZER_STATE_DIR`. It checks the line written, empty stdout and stderr, exit 0, and a read-only state directory (FR-018).
