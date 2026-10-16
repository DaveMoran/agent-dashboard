# Feature Specification: Attention Hook

**Feature Branch**: `005-attention-hook`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Add the opt-in attention hook, so a brain can show red when an agent is waiting for the user. Provide a small hook script plus documented settings that the user adds to their own user-level Claude Code settings (the visualizer never installs or edits hooks or settings). The hook appends one JSON line per event (timestamp, session ID, `cwd`, event name and type) to a file in the visualizer's state directory, never in an observed repo. Research which Claude Code hook events mark \"waiting for the user\" and \"done waiting\" (for example the `Notification` permission and idle prompts, `PermissionRequest`, `UserPromptSubmit`, `Stop`, `SessionEnd`) and record the mapping. Add a hook-backed agent source that reads this file incrementally and combines with the 004 transcript source: a session is waiting from a waiting event until the next prompt, tool result or stop; `SessionEnd` ends the session. Without the hook installed everything still works and nothing is ever red. Fixture-driven tests for the state combination, including events that arrive out of order."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See when a main agent is waiting for me (Priority: P1)

A developer runs several Claude Code main sessions at once. One of them stops mid-turn to ask for permission to run a command, or asks the developer a question, and sits there until the developer answers. With the attention hook installed, the visualizer reports that session as `waiting` from the moment it starts waiting until the developer answers (or the turn ends some other way), so the developer can see which agent needs them instead of discovering it minutes later.

**Why this priority**: Waiting is the one state the transcripts cannot show (a permission prompt looks exactly like a long-running tool call), and it is the state the developer most needs to act on. It is the reason for this feature.

**Independent Test**: Feed fixture transcripts and a fixture hook events file through the combined source and check each session's state after each transcript entry and each hook event.

**Acceptance Scenarios**:

1. **Given** a working main session, **When** a hook event arrives saying the session is asking for permission to use a tool, **Then** the session is `waiting`, and its state-since time is the hook event's timestamp.
2. **Given** a working main session, **When** a hook event arrives saying the agent has asked the user a question (including asking to approve a plan), **Then** the session is `waiting`.
3. **Given** a session that is `waiting` on a permission prompt, **When** the transcript records the result of that tool call (the user allowed or denied it), **Then** the session is `working` again.
4. **Given** a session that is `waiting`, **When** the transcript records a new user prompt, an interruption, or the final reply of the turn, or a hook event records a prompt submission or a stop, **Then** the session is no longer `waiting` and takes the state the transcript gives it (`working` or `standby`).
5. **Given** a session that is `waiting` because a subagent it started asked for permission, **When** that subagent's transcript records the tool result, **Then** the session is no longer `waiting`.
6. **Given** a session that is `waiting` while one of its background subagents is still running, **When** its state is reported, **Then** it is `waiting` (waiting takes precedence over working) and still reports its running subagent count.
7. **Given** a session's state changes into or out of `waiting`, **When** the change is detected, **Then** exactly one state-change notification is emitted, as for the other states.

---

### User Story 2 - Events that arrive out of order (Priority: P1)

The hook writes its events file and Claude Code writes the transcript independently, and the visualizer may read either one first. A permission prompt that the developer answers within a second can therefore show up as "tool result in the transcript" before "permission requested" in the events file. The visualizer must give the same answer whichever it reads first, and must never leave a session stuck red after its wait has already ended.

**Why this priority**: Without this, a brain would turn red and stay red after the developer has already answered, which is worse than not showing red at all.

**Independent Test**: Feed the same transcript and hook events to the combined source in different interleavings (transcript first, hook first, mixed) and check that the final state is the same in every order, and that no intermediate state is `waiting` when the wait had already ended before the events were read.

**Acceptance Scenarios**:

1. **Given** a transcript whose tool result is timestamped after a permission event, **When** the transcript is read before the hook event, **Then** the session does not become `waiting` when the hook event is later read.
2. **Given** a waiting event that is timestamped after the latest prompt, tool result, interruption and final reply of its session, **When** it is read, **Then** the session is `waiting`, whatever the order the files were read in.
3. **Given** hook events in the file that are not in timestamp order (two sessions writing at once), **When** they are read, **Then** each is applied by its own timestamp, and the result is the same as if they had been in order.
4. **Given** a hook event for a session that the transcript source does not know yet, **When** it is read, **Then** it is held and applied once the session appears, and only if nothing in the transcript has ended the wait by then.

---

### User Story 3 - Install the hook myself, safely (Priority: P1)

The developer decides to turn on red. They follow the documentation: copy a settings snippet into their own user-level Claude Code settings, pointing at a hook script that ships with the visualizer. From then on every Claude Code session on the machine reports its attention events to the visualizer's state directory. The hook never slows Claude Code down noticeably, never prints anything that Claude Code would act on, never blocks or changes a decision, and never fails a session even if the visualizer is not running or the state directory cannot be written.

**Why this priority**: The hook runs inside every Claude Code session on the machine. If it is slow, noisy or fragile, the developer will remove it, and with it the red state.

**Independent Test**: Run the hook script with sample hook inputs on standard input and a temporary state directory, and check the lines it appends, its exit status, that it prints nothing, and that it still exits cleanly when the state directory is read-only or the input is malformed.

**Acceptance Scenarios**:

1. **Given** the hook script receives a hook event on standard input, **When** it runs, **Then** it appends exactly one line to the events file containing the timestamp, session ID, working directory, event name and event type, and nothing else from the input.
2. **Given** the events file or the state directory does not exist, **When** the hook runs, **Then** it creates them and appends the line.
3. **Given** the state directory cannot be written, or the input is not valid JSON, **When** the hook runs, **Then** it exits successfully without output and Claude Code carries on as if no hook were installed.
4. **Given** any event, **When** the hook runs, **Then** it writes nothing to standard output or standard error and exits with success, so it never adds context, blocks a prompt, or answers a permission request.
5. **Given** several sessions fire hooks at the same moment, **When** they append, **Then** every event is a separate, complete line; no two lines are interleaved.
6. **Given** the documentation, **When** the developer reads it, **Then** it shows the exact settings to add (which events, which matchers, the script path), where the events file lives, how to check it is working, and how to remove the hook again.
7. **Given** the visualizer's state directory is overridden by environment variable, **When** the hook runs with that variable set, **Then** it writes into the overridden directory.

---

### User Story 4 - Without the hook, nothing changes (Priority: P1)

A developer who has not installed the hook, or who removes it, sees exactly the 004 behavior: sessions are `working` or `standby` from their transcripts, and nothing is ever `waiting`.

**Why this priority**: The hook is opt-in. The visualizer must not depend on it, warn about it on every start, or misbehave when the events file is missing.

**Independent Test**: Run the combined source with fixture transcripts and no events file, and check that every state matches the 004 transcript source alone.

**Acceptance Scenarios**:

1. **Given** no events file exists, **When** the visualizer runs, **Then** all session states equal those of the transcript source alone, no session is ever `waiting`, and no error or issue is reported.
2. **Given** the events file appears while the visualizer runs (the developer installs the hook), **When** the next events are written, **Then** they are picked up without a restart.
3. **Given** the events file is removed, truncated or replaced (for example the developer deletes it), **When** it is next read, **Then** reading continues from the start of the new file without errors, and waits already recorded stay until something ends them.

---

### User Story 5 - Sessions that end (Priority: P2)

When the developer quits a Claude Code session, the hook records that the session ended. The visualizer stops reporting it, so a project whose sessions have all been closed no longer looks active. Without the hook, sessions are never ended this way (006's idle timeout covers them).

**Why this priority**: It makes brains free up promptly in 006 when the developer closes a session, instead of waiting for the idle timeout. It is P2 because the idle timeout still covers it.

**Independent Test**: Feed a fixture transcript and a session-end event and check that the session disappears from the sessions list and a single end notification is emitted.

**Acceptance Scenarios**:

1. **Given** a known session, **When** a session-end event for it is read, **Then** the session is no longer reported by the source or the sessions endpoint, and consumers receive exactly one notification that it ended.
2. **Given** an ended session, **When** a later transcript entry or hook event for it arrives (the session was resumed), **Then** it is reported again, as a newly appearing session.
3. **Given** a session-end event timestamped before the session's latest transcript entry, **When** it is read, **Then** the session is not ended.
4. **Given** a project whose only main session ends, **When** sessions are listed, **Then** that project is not listed.

---

### User Story 6 - Check that the hook is working (Priority: P3)

After installing the hook, the developer wants to know whether the visualizer is receiving its events, without reading files by hand.

**Why this priority**: It turns "nothing is red" from ambiguous (no one is waiting, or the hook is broken?) into something the developer can check. It is P3 because the events file can also be inspected directly.

**Independent Test**: Start the server with and without a fixture events file and check the reported hook status.

**Acceptance Scenarios**:

1. **Given** no events file, **When** the developer asks the running visualizer for its health, **Then** it reports that no attention hook events have been seen.
2. **Given** an events file with events, **When** the developer asks for health, **Then** it reports that hook events have been seen and the time of the most recent one.

### Edge Cases

- A waiting event for a session that is not a main-agent session: recorded but has no visible effect, since only main sessions are listed (a later model switch applies it if the wait is still open).
- A waiting event for a session that never appears in the transcripts: held for a bounded time and then dropped; it never creates a session by itself.
- A waiting event while the session is already `standby` (for example a late notification after the turn ended): the session becomes `waiting` only if the event is later than the turn's final reply; otherwise it is ignored.
- Two waiting events in a row (two permission prompts, or parallel subagents asking at once): the session stays `waiting` until something ends the wait; the second event emits no extra state change. One tool result ends the wait even if another subagent's request is still open; the next waiting event turns it red again.
- The developer answers a permission prompt by switching to "always allow": the tool result still appears in the transcript, which ends the wait.
- An event mapped as neither waiting, nor ending a wait, nor ending the session (for example a future hook event): recorded and ignored.
- Hook lines that are not valid JSON, or that lack a timestamp or session ID: skipped and recorded as an ingest issue; the rest of the file is still read.
- An events file left from weeks ago: old events are read once at start; they cannot make a session red because every session's later transcript activity has ended them, and session-end events for sessions that no longer exist are dropped.
- The clock: hook timestamps and transcript timestamps both come from the same machine; comparisons use those timestamps, not the time the visualizer read them.
- The hook writes into the visualizer's state directory, never into the session's working directory or any observed repository, and the visualizer never writes into the events file.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST ship a hook script that the user can reference from their own user-level Claude Code settings. The visualizer MUST NOT install, write or edit any Claude Code hook or settings file.
- **FR-002**: For each hook invocation, the script MUST append exactly one line to the events file in the visualizer's state directory (the same directory as the rest of the visualizer's state, including its environment-variable override), containing only: the time it ran, the session ID, the working directory, the hook event name and the event type (the notification type, or the tool name for tool events). It MUST NOT record prompt text, notification messages, tool input or any other content.
- **FR-003**: The hook script MUST exit successfully and write nothing to standard output or standard error in every case, including invalid input and an unwritable state directory, so it never adds context, blocks, or answers anything in Claude Code. It MUST create the state directory and events file if missing.
- **FR-004**: The hook script MUST write each line with a single append so that concurrent hooks never interleave lines.
- **FR-005**: The project MUST research and record, in its design documents, which Claude Code hook events (and which notification types or tool matchers) mean "started waiting for the user", which mean "done waiting", and which mean "session ended", covering at least: permission prompts, questions the agent asks the user (including plan approval), prompt submission, turn stop and session end. The documented settings MUST subscribe to exactly the events in that mapping.
- **FR-006**: The system MUST provide a hook-backed agent source that reads the events file incrementally with the same rules as transcripts (remember the position, read only appended content, hold back an incomplete line, start again when the file is shorter or replaced), and that treats a missing events file as no events, without error, picking it up when it appears.
- **FR-007**: The system MUST combine the hook-backed source with the transcript source into one agent source that consumers use in place of the transcript source, without changes to consumers beyond handling the new `waiting` state and session end.
- **FR-008**: A main session MUST be `waiting` when its most recent waiting event is later than every wait-ending signal for that session. Wait-ending signals are: a user prompt, a tool result (in its own or any of its subagents' transcripts), an interruption, a final reply of the turn, and hook events mapped as "done waiting" (such as prompt submission and stop). Otherwise its state is what the transcript source gives (`working` or `standby`).
- **FR-009**: `waiting` MUST take precedence over `working` and `standby`. The session's running-subagent count and last activity MUST still be reported while it is waiting, and the waiting event's timestamp MUST count as activity.
- **FR-010**: The combined state MUST depend only on event timestamps, not on the order in which the transcript and events file are read; reading the same inputs in any interleaving MUST give the same final states, and MUST never report `waiting` for a wait that an already-read signal had ended.
- **FR-011**: Hook events for sessions not yet known MUST be held and applied when the session appears; held events for sessions that do not appear within a bounded time (default 10 minutes) MUST be dropped. Hook events MUST NOT create sessions on their own.
- **FR-012**: A session-end event MUST end the session if it is later than the session's most recent transcript entry: the session is no longer reported, and consumers receive exactly one session-ended notification. A later transcript entry or hook event for that session MUST bring it back as a newly appearing session. The agent source interface MUST gain this session-ended notification.
- **FR-013**: Hook lines that are not valid JSON or lack a timestamp, session ID or event name MUST be skipped and recorded as ingest issues, and reading MUST continue.
- **FR-014**: The sessions endpoint and its shared contract MUST include `waiting` as a session state; sessions that have ended MUST NOT be listed.
- **FR-015**: The health endpoint MUST report whether any attention hook event has been read and the timestamp of the most recent one.
- **FR-016**: With no events file, every session's state MUST equal what the transcript source alone reports, and no session is ever `waiting`.
- **FR-017**: The documentation MUST show the exact settings snippet to add to user-level Claude Code settings, where the hook script and events file live, how to check that events are arriving, how to remove the hook, and that the events file can be deleted at any time; and MUST state that the visualizer never edits these settings itself.
- **FR-018**: Tests MUST be fixture-driven, using recorded transcripts and a recorded events file under `fixtures/`, and MUST cover at least: a permission wait ended by a tool result; a question wait ended by the answer; a wait ended by an interruption; a wait raised by a subagent and ended in its transcript; waiting with background subagents running; a tool result read before its waiting event (out of order); events in the file out of timestamp order; an event for a session that appears later; a session end and a resumed session; malformed hook lines; no events file; and the hook script itself (output line, silence, exit status, unwritable directory).

### Key Entities *(include if feature involves data)*

- **Hook event (as recorded)**: timestamp, session ID, working directory, event name, event type. One line in the events file.
- **Event mapping**: for each hook event name and type, its meaning: starts a wait, ends a wait, ends the session, or ignored.
- **Wait**: a session's open waiting period, from the timestamp of the waiting event; ended by any later wait-ending signal.
- **Session (extended)**: the 004 session plus its latest waiting-event time, its latest wait-ending time, and whether it has ended. Its state can now also be `waiting`.
- **Session-ended notification**: session ID, project identity, time of the end event.
- **Hook status**: whether any hook event has been read, and the time of the most recent one.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every fixture scenario listed in FR-018, the reported state after each transcript entry and each hook event matches the expected state in 100% of cases.
- **SC-002**: For every out-of-order fixture, all read orders give identical final states, and none reports `waiting` for an already-ended wait.
- **SC-003**: A waiting event written by the hook is reflected in the sessions endpoint within 1 second, and the end of the wait within 1 second of the ending transcript entry or hook event being written.
- **SC-004**: The hook script completes in under 100 ms per event on the developer's machine, prints nothing and always exits successfully.
- **SC-005**: With no events file, the sessions endpoint's output is identical to 004's for the same transcripts.
- **SC-006**: A developer can install the hook from the documentation alone, and confirm it works through the health endpoint, in under 5 minutes.
- **SC-007**: After a full test run, no fixture, transcript or settings file has been modified, and nothing has been written outside temporary directories and the visualizer's own state directory.

## Assumptions

- Claude Code passes each hook a JSON object on standard input that includes at least the session ID, working directory and hook event name, plus a notification type for notifications and a tool name for tool events. The exact events and fields are confirmed during research (FR-005).
- A hook fired inside a subagent reports the parent (main) session's ID, so a subagent's permission prompt makes its main session wait. Research confirms this; if not, subagent waits are matched to their parent through the transcript source.
- The hook script runs with tools already present on the developer's machine (the same runtime the visualizer uses); no extra software is installed.
- "Waiting" means the agent is blocked mid-turn on the user (a permission prompt or a question). Claude Code's "idle" notification, sent some time after a turn has already ended, does not make a session `waiting`: that session is on standby, its turn is done.
- The events file is not rotated or trimmed. A line is about 200 bytes and the hook fires only on a few events per turn, so growth is slow; the developer can delete the file at any time. Bounding it is revisited only if size becomes a problem in practice.
- Session end comes only from the hook. Without the hook, sessions are never ended this way; 006's idle timeout decides when they stop counting.
- What the session is waiting for (which tool, which question) is not shown in V1; only the fact that it is waiting. Exposing the reason (for example for the hardware's "what is it waiting on") is later work.
- The server still starts with a repo path, as in 004; starting without one comes in 006.
