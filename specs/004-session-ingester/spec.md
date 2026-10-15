# Feature Specification: Session Ingester

**Feature Branch**: `004-session-ingester`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Read Claude Code session transcripts from every project folder under `~/.claude/projects/` and work out which agents are active and what they are doing. Tail every session `*.jsonl` incrementally (track byte offsets, handle partial lines) and read from each entry only what V1 needs: timestamp, session ID, model, `cwd`, and whether the entry is a user prompt, a tool call, a tool result or a final assistant reply. Group sessions into projects: a project is the git common dir of the session's `cwd` (so all worktrees of one repo are one project), or the `cwd` itself outside git. A session is a \"main agent\" session when its model matches a configurable regex (default `^claude-(opus|fable)`); only main-agent sessions count in V1. Derive each main session's state from the transcript alone: working (a prompt or tool call has no final assistant reply yet; a running subagent counts, since its tool call is still open) or standby (the last turn ended). \"Waiting\" comes in 005. Put this behind a small \"agent source\" interface (sessions and their state changes) so the hook source (005) and a future Agent SDK source plug in without changing consumers. Expose `/api/sessions` (projects, their main sessions, each session's state and last activity). Test against recorded sample JSONL in `fixtures/transcripts/`, including a turn that runs a subagent and a project with two worktrees."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know whether each main agent is working or on standby (Priority: P1)

A developer has one or more Claude Code sessions open. For each session driven by a main-agent model (Opus or Fable by default), the visualizer works out from the session's transcript whether the agent is currently working on a turn or has finished it and is on standby, and when it was last active. A turn counts as working from the user's prompt until the agent's final reply, including all the time the agent spends calling tools and waiting for subagents it has started.

**Why this priority**: Working versus standby is the core signal every later V1 feature (brains, live updates, the MAGI panel) is built on. Without it there is nothing to display.

**Independent Test**: Feed recorded transcripts from `fixtures/transcripts/` through the transcript source and check each session's state and last activity time after each line.

**Acceptance Scenarios**:

1. **Given** a main-agent transcript whose last entry is a user prompt, **When** it is read, **Then** the session is `working` and its last activity is that prompt's timestamp.
2. **Given** a main-agent transcript whose last entry is an assistant message that calls a tool, with no result yet, **When** it is read, **Then** the session is `working`.
3. **Given** a main-agent transcript whose last entry is a tool result, **When** it is read, **Then** the session is `working` (the agent has not replied yet).
4. **Given** a main-agent transcript whose last entry is the assistant's final reply to the turn (a reply that calls no tool), **When** it is read, **Then** the session is `standby`.
5. **Given** a turn in which the main agent starts a subagent and the subagent is still running, so the main agent's subagent tool call has no result yet, **When** the main transcript is read, **Then** the session is `working`, and it becomes `standby` only after the subagent's result arrives and the main agent gives its final reply.
6. **Given** a turn the user interrupted, so the transcript records an interruption after an open prompt or tool call, **When** it is read, **Then** the session is `standby`.
7. **Given** a session whose state changes from `standby` to `working` or back, **When** the change is detected, **Then** exactly one state-change notification is emitted naming the session, its new state and the time of the entry that caused it.

---

### User Story 2 - Sessions grouped by project, across worktrees (Priority: P1)

The developer works on a repo from several git worktrees at once (for example a planner in one and a coder in another), and also has sessions in other repos and in folders outside git. The visualizer groups sessions into projects: all sessions whose working directory belongs to the same repository, in any of its worktrees, form one project; a session outside git forms a project of its own working directory.

**Why this priority**: Later features assign whole projects, not sessions, to MAGI brains. Getting the grouping wrong would split one repo across two brains or merge unrelated work.

**Independent Test**: Using fixture transcripts whose working directories point into a temporary git repo with two worktrees, plus one outside git, check that the two worktree sessions form one project and the other forms its own.

**Acceptance Scenarios**:

1. **Given** two main-agent sessions whose working directories are two worktrees of the same repository, **When** sessions are grouped, **Then** they belong to one project whose identity is the repository's shared git directory, and its name is the repository's folder name.
2. **Given** a session whose working directory is a subfolder of a repository, **When** it is grouped, **Then** it belongs to that repository's project.
3. **Given** a session whose working directory is not inside any git repository, **When** it is grouped, **Then** its project is that working directory and its name is the folder name.
4. **Given** sessions from two different repositories, **When** they are grouped, **Then** they form two projects.
5. **Given** a session whose working directory no longer exists on disk, **When** it is grouped, **Then** its project is that working directory as recorded, and the other sessions are unaffected.

---

### User Story 3 - Only main agents count (Priority: P1)

The developer's setup runs a main agent (Opus or Fable) that hands work to Sonnet subagents, and they may also have other side sessions on smaller models. Only main-agent sessions should light up a project in V1. The developer can change which models count as main agents in the visualizer's configuration.

**Why this priority**: Without this rule, every helper session would claim a project and a brain, and the MAGI view would stop meaning "where are my main agents".

**Independent Test**: Read fixture transcripts with Opus, Fable, Sonnet and Haiku sessions, with the default and with a custom pattern, and check which sessions are reported.

**Acceptance Scenarios**:

1. **Given** sessions whose models are `claude-opus-5-5`, `claude-fable-5-1` and `claude-sonnet-5-5`, **When** the default pattern is used, **Then** the Opus and Fable sessions are main-agent sessions and the Sonnet session is not.
2. **Given** a configured pattern `^claude-sonnet`, **When** the same sessions are read, **Then** only the Sonnet session is a main-agent session.
3. **Given** an invalid pattern in the configuration, **When** the visualizer starts, **Then** it reports a clear configuration error naming the setting and falls back to the default pattern.
4. **Given** a session that switched model partway through, **When** it is read, **Then** whether it is a main-agent session follows the model of its most recent assistant entry.
5. **Given** a subagent's own transcript, **When** transcripts are scanned, **Then** it is never reported as a session of its own; it only affects its parent through the parent's open tool call.
6. **Given** a project whose only sessions are not main-agent sessions, **When** sessions are listed, **Then** that project is not listed.

---

### User Story 4 - Live, incremental reading (Priority: P1)

Sessions keep writing to their transcripts while the visualizer runs, and new sessions and new project folders appear. The visualizer picks up new entries as they are written, without re-reading whole files, and copes with a line that is only half written when it looks.

**Why this priority**: Transcripts grow to many megabytes. Re-reading them on every change would be slow, and treating a half-written line as broken would lose events.

**Independent Test**: Append to a copy of a fixture transcript in a temporary folder in several steps, including a step that ends mid-line, and check that each entry is seen exactly once and the state follows along.

**Acceptance Scenarios**:

1. **Given** a transcript already read up to some point, **When** new lines are appended, **Then** only the new lines are read and each entry is processed exactly once.
2. **Given** an append that ends partway through a line, **When** it is read, **Then** the partial line is held back and processed once the rest of the line arrives.
3. **Given** a new session file, or a new project folder, appearing under the transcripts root while the visualizer runs, **When** it is noticed, **Then** its sessions are read and reported without a restart.
4. **Given** a line that is complete but not valid JSON, or a valid entry missing fields this feature needs, **When** it is read, **Then** that line is skipped, the rest of the file is still read, and the skip is recorded as an issue.
5. **Given** a transcript file that becomes shorter than the position already read (truncated or replaced), **When** it is next read, **Then** it is read again from the start.
6. **Given** a transcripts root folder that does not exist, **When** the visualizer starts, **Then** it reports no sessions and no error, and picks up sessions once the folder appears.

---

### User Story 5 - Ask for the current sessions (Priority: P2)

The developer, or the later MAGI features, asks the running visualizer for the current picture: every project with at least one main-agent session, its main sessions, each session's state and last activity.

**Why this priority**: It makes the ingester observable and testable end to end, and gives 006 and 007 a stable read model. It is P2 because the in-process source already delivers the value to other server code.

**Independent Test**: Start the server with the transcripts root pointed at a fixture folder, request the sessions endpoint and compare the response with the expected projects and sessions.

**Acceptance Scenarios**:

1. **Given** fixture transcripts for two projects, **When** the sessions endpoint is requested, **Then** the response lists both projects, each with its identity, name and main sessions, and each session with its ID, model, working directory, state and last activity time.
2. **Given** no main-agent sessions, **When** the endpoint is requested, **Then** the response contains an empty project list.
3. **Given** a project with several main sessions, **When** the endpoint is requested, **Then** its sessions are ordered by last activity, most recent first, and projects are ordered by their most recent session's activity.

---

### User Story 6 - Pluggable agent sources (Priority: P2)

The transcript reader is one "agent source": something that knows a set of sessions and announces when their states change. The attention hook (005) and, later, the Agent SDK will be other sources. Code that consumes sessions (the sessions endpoint now, brain slots in 006) must work with any source, or a combination, without changes.

**Why this priority**: It keeps 005 and the Agent SDK work from reshaping consumers. It is P2 because only one source exists in this feature.

**Independent Test**: Drive the sessions endpoint from a stub source that emits scripted sessions and state changes, and check the response matches the stub, with no transcript files involved.

**Acceptance Scenarios**:

1. **Given** a stub agent source with two scripted sessions, **When** a consumer asks it for its sessions, **Then** it receives both with their states, and when the stub emits a state change the consumer is notified with the session and new state.
2. **Given** a consumer that stops listening, **When** later changes occur, **Then** it is no longer notified.
3. **Given** a source that is stopped, **When** it stops, **Then** it releases its file watchers and emits nothing further.

### Edge Cases

- A session's transcript contains entries from more than one working directory (for example after changing folder): the session's project follows its most recent entry's working directory.
- A session has prompts but no assistant entry yet, so its model is unknown: it is not a main-agent session until an assistant entry with a model appears. This may delay a brand-new session showing as working by the time it takes the first reply to start.
- An assistant entry without a model, or with a synthetic placeholder model, does not change the session's known model.
- Entries that are not prompts, tool calls, tool results or assistant replies (summaries, system notices, file snapshots, metadata lines) do not change state, but they do update last activity when they carry a timestamp.
- A turn whose assistant reply is split across several entries (thinking, text, tool calls): only an assistant entry that ends the turn without calling a tool makes the session `standby`.
- Several tool calls are open at once (parallel tool calls): the session stays `working` until all have results and the agent replies.
- A session that crashed or was killed mid-turn stays `working` with an old last-activity time. Deciding when such a session no longer counts is left to brain slots (006, idle timeout).
- Very large transcripts on first start: the existing content is read once to establish state, then only appended content is read.
- Many sessions change at the same moment (for example a burst of file writes): every change is processed and no state change is lost or duplicated.
- The same session ID appears under two project folders (rare, after moving a project): it is reported once, using the file with the most recent entry.
- Transcript files are never written, moved, locked or deleted by the visualizer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST discover session transcript files in every project folder directly under the transcripts root, which defaults to `~/.claude/projects/` and can be overridden in configuration or by environment variable for tests.
- **FR-002**: The system MUST treat each top-level transcript file in a project folder as one session, identified by the session ID recorded in its entries (falling back to the file name), and MUST NOT treat subagent transcripts as sessions.
- **FR-003**: The system MUST read each transcript incrementally: remember how far it has read, read only appended content, hold back an incomplete last line until it is completed, and start again from the beginning if the file becomes shorter than the remembered position.
- **FR-004**: From each entry the system MUST extract only: timestamp, session ID, model (assistant entries), working directory, and the entry kind (user prompt, tool call, tool result, final assistant reply, interruption, or other). Message content beyond what is needed to determine the kind MUST NOT be retained.
- **FR-005**: The system MUST skip lines that are not valid JSON or lack the needed fields, record each skip as an issue (file and line position), and continue reading the rest of the file.
- **FR-006**: The system MUST group sessions into projects: a project is identified by the shared git directory of the session's working directory, so all worktrees and subfolders of one repository form one project; outside git, or when the folder no longer exists, the project is the working directory itself. The project name is the repository's folder name (or the working directory's folder name outside git).
- **FR-007**: The system MUST classify a session as a main-agent session when the model of its most recent assistant entry matches a configurable pattern, defaulting to `^claude-(opus|fable)`. An invalid pattern MUST produce a configuration error naming the setting and fall back to the default.
- **FR-008**: The system MUST derive each main-agent session's state from its transcript alone: `working` from a user prompt until the final assistant reply of that turn, including while any tool call (a subagent call included) has no result; `standby` after a final assistant reply or a recorded interruption, and for a session with no turns yet.
- **FR-009**: The system MUST record each session's last activity as the timestamp of its most recent timestamped entry.
- **FR-010**: The system MUST notify consumers of each session state change exactly once, with the session, its project, the new state and the time of the entry that caused it; and MUST notify when a session first appears.
- **FR-011**: The system MUST notice new transcript files and new project folders while running, and MUST start with no sessions and no error when the transcripts root does not exist, picking it up once it appears.
- **FR-012**: The session-tracking behavior MUST sit behind an agent source interface that offers: the current sessions with their project, model, state and last activity; subscription to session appearance and state changes, with unsubscription; and start and stop. Consumers MUST depend only on this interface, not on transcripts.
- **FR-013**: The system MUST expose a sessions endpoint at `/api/sessions` returning every project that has at least one main-agent session, with its identity and name, and its main sessions, each with session ID, model, working directory, state and last activity, ordered most recent first (sessions within a project, and projects by their most recent session). The response's shape MUST be defined in the shared API contract so the UI can use it.
- **FR-014**: The system MUST never write to, move, lock or delete transcript files or anything in an observed repository; any state it keeps lives in memory or in the visualizer's own state directory.
- **FR-015**: Tests MUST use recorded sample transcripts under `fixtures/transcripts/`, covering at least: a plain turn ending in standby; a turn with tool calls; a turn that runs a subagent (with the subagent's own transcript present); an interrupted turn; a non-main (Sonnet) session; a project spanning two worktrees; and malformed and partial lines. Fixture content MUST be trimmed of private conversation text.

### Key Entities *(include if feature involves data)*

- **Transcript entry (as read)**: timestamp, session ID, model if present, working directory, and kind (prompt, tool call with its call IDs, tool result with the call IDs it answers, final reply, interruption, other). Nothing else from the entry is kept.
- **Session**: session ID, transcript file location, model (latest known), working directory (latest), project, whether it is a main-agent session, state (`working` or `standby`; `waiting` is added in 005), open tool calls, last activity time.
- **Project**: identity (shared git directory, or working directory outside git), display name, and its sessions.
- **Agent source**: anything that provides sessions and announces their appearance and state changes; the transcript source is the first.
- **State change**: session ID, project identity, previous state, new state, time of the causing entry.
- **Ingest issue**: file, position and reason for a skipped line or unreadable file.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every fixture scenario listed in FR-015, the reported state after each entry matches the expected state in 100% of cases.
- **SC-002**: A state change written to a transcript is reflected in the sessions endpoint within 1 second.
- **SC-003**: On a machine with 200 transcript files totalling 500 MB, the first full read completes within 10 seconds, and afterwards appending one line re-reads only that line.
- **SC-004**: Two sessions in different worktrees of one repository are always reported as one project, and sessions in different repositories never are.
- **SC-005**: Replacing the transcript source with a stub source requires no change to the sessions endpoint or any other consumer.
- **SC-006**: After a full test run, no fixture or transcript file has been modified (the observer stays read-only).

## Assumptions

- The transcript format is Claude Code's current JSONL: one JSON object per line with fields for type, timestamp, session ID, working directory and, for assistant entries, the model and message content. A final reply is an assistant entry that ends the turn without a tool call; a tool call and its result are linked by a call ID. Subagent transcripts live in a per-session subfolder and are not top-level files.
- The server still starts with a repo path in this feature (as since 001); the session ingester runs independently of that path and covers all projects. Starting without a repo path comes in 006.
- The main-agent pattern lives in the existing `agent-visualizer.config.json` under a new setting; the transcripts root override is also a setting, plus an environment variable for tests.
- Idle timeouts, ending sessions and brain assignment are out of scope (006). Waiting and session end from hooks are out of scope (005). Subagent sessions, event normalization and spec attribution are out of scope (project view, later).
- Resolving the shared git directory uses read-only git queries and is cached per working directory.
- Non-main sessions are still read (so a model switch is noticed) but are not listed by the sessions endpoint.
