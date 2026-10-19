# Feature Specification: MAGI Slots

**Feature Branch**: `006-magi-slots`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Begin work on spec-006" — seed `006-magi-slots` from `docs/feature-seeds.md`: "Assign projects to the three MAGI brains. Brains, in order: MELCHIOR (1), BALTHASAR (2), CASPER (3). When a project's first main-agent session becomes active, the project takes the lowest free brain and keeps it while it stays active (no reshuffling). A brain is freed, back to not active, when all of its project's main sessions have ended or been idle longer than a configurable timeout (default 30 minutes). A fourth active project gets no brain and is not shown; when a brain frees, the most recently active waiting project takes it. Brain state: not active (no project), waiting (any main session waiting), working (any main session working), otherwise standby. `agent-visualizer` now starts without a repo path (a path is no longer required); decide and document where `server.json` lives in that case. Expose `/api/magi` (three brains, each with state, project path and name, and when the state last changed); define its response types in `src/contract/`, the only server module the UI may import. Tests use fixture sessions."

## Terms

- **Brain**: one of three fixed display slots, in order MELCHIOR (1), BALTHASAR (2), CASPER (3).
- **Main session**: a session the 004 main-agent rule marks as a main agent (by default an Opus or Fable model). Other sessions never affect brains.
- **Live main session**: a main session that has not ended (005 session end) and whose last activity is no older than the idle timeout (the longer waiting timeout while it is `waiting`).
- **Active project**: a project with at least one live main session.
- **Queued project**: an active project that holds no brain because all three are taken. (Distinct from the `waiting` state, which means an agent is waiting for the user.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Each active project gets its own brain (Priority: P1)

A developer works on up to three projects at once, each with its own Opus or Fable main session. When they start a main session in a project, that project lights up the lowest-numbered free brain and keeps it for as long as it stays active, so the developer learns "MELCHIOR is the visualizer repo, BALTHASAR is the API" and never has to re-read which brain is which.

**Why this priority**: Stable brain assignment is the core of the MAGI view; every later screen and the planned hardware buttons (one per brain) depend on it.

**Independent Test**: Feed fixture sessions for several projects through the slot logic, advancing a test clock, and check which project each brain holds after each step.

**Acceptance Scenarios**:

1. **Given** all three brains are free, **When** a main session becomes live in project A, **Then** A takes MELCHIOR.
2. **Given** A holds MELCHIOR, **When** a main session becomes live in project B, **Then** B takes BALTHASAR; a third project C then takes CASPER.
3. **Given** A holds MELCHIOR and B holds BALTHASAR, **When** A becomes inactive, **Then** MELCHIOR becomes not active and B stays on BALTHASAR (no reshuffling).
4. **Given** MELCHIOR is free and BALTHASAR is held by B, **When** a new project D becomes active, **Then** D takes MELCHIOR (the lowest free brain).
5. **Given** A holds MELCHIOR with one live main session, **When** a second main session starts in A (another worktree of the same repo, or a second terminal), **Then** A keeps MELCHIOR and takes no second brain.
6. **Given** a project whose only sessions are non-main (for example Sonnet sessions or subagents), **When** they are active, **Then** the project takes no brain.

---

### User Story 2 - Brains free up when work stops (Priority: P1)

When the developer closes their last main session in a project, or leaves it idle for longer than the idle timeout, the project's brain goes back to not active so the slot is ready for the next project. A session that crashed mid-turn, and so never wrote a final reply, stops counting once it has been silent for the idle timeout instead of keeping its brain working forever.

**Why this priority**: Without freeing, brains fill up once and never change, and a crashed session lights a brain as working indefinitely (a problem seen in this repo's own transcripts during 004 and 005).

**Independent Test**: Feed fixture sessions, then advance the test clock past the timeout or feed a session-end event, and check the brain's state and project.

**Acceptance Scenarios**:

1. **Given** A holds MELCHIOR with one main session, **When** that session ends (a 005 session-end event), **Then** MELCHIOR becomes not active, with no project.
2. **Given** A holds MELCHIOR with one main session on standby, **When** the idle timeout passes with no activity in it, **Then** MELCHIOR becomes not active within 5 seconds of the timeout passing, without any new transcript or hook event arriving.
3. **Given** A holds MELCHIOR with two main sessions, **When** one ends and the other is still live, **Then** A keeps MELCHIOR.
4. **Given** a main session in A whose transcript stopped mid-turn (still reported `working`) and no other live session, **When** the idle timeout passes with no activity, **Then** MELCHIOR becomes not active.
5. **Given** a main session in A that went past the idle timeout while another session in A stays live on standby, **When** A's brain state is computed, **Then** the timed-out session does not count, and the brain shows standby, not working.
6. **Given** a project whose brain was freed, **When** one of its main sessions shows new activity (resumed), **Then** the project becomes active again and takes the lowest free brain, which may be a different brain than before.
7. **Given** a configured idle timeout of 10 minutes, **When** a main session has been silent for 11 minutes, **Then** it no longer counts as live.
8. **Given** A holds MELCHIOR with one main session that is `waiting`, **When** 45 minutes pass with no activity, **Then** A keeps MELCHIOR and the brain stays `waiting`.
9. **Given** A holds MELCHIOR with one main session that is `waiting`, **When** the waiting timeout (default 4 hours) passes with no activity, **Then** MELCHIOR becomes not active.

---

### User Story 3 - See what each brain's agent is doing (Priority: P1)

For each brain, the developer sees one state: not active when it has no project; waiting when any of the project's live main sessions is waiting for the user; otherwise working when any is working; otherwise standby. They also see when that state began, so they can tell a brain that just went red from one that has been red for twenty minutes.

**Why this priority**: The state is what the developer acts on; the brain-to-project mapping alone is not useful.

**Independent Test**: Feed fixture sessions with mixed states in one project and check the brain state and its change time after each step.

**Acceptance Scenarios**:

1. **Given** a project with one live main session on standby and another working, **When** its brain state is computed, **Then** it is `working`.
2. **Given** a project with one session working and another waiting, **When** its brain state is computed, **Then** it is `waiting`.
3. **Given** a project whose live main sessions are all on standby, **When** its brain state is computed, **Then** it is `standby`.
4. **Given** a brain with no project, **When** its state is reported, **Then** it is `not-active` and its project is empty.
5. **Given** a brain that is `working`, **When** its project's only working session goes to standby, **Then** the brain's state becomes `standby` and its state-since time is the time of that session's change.
6. **Given** a brain that is `working` because one session works, **When** a second session in the same project also starts working, **Then** the brain's state and state-since time do not change.
7. **Given** a brain that takes a new project, or is freed, **When** its state is reported, **Then** its state-since time is the moment that happened.

---

### User Story 4 - A fourth project waits its turn (Priority: P2)

The developer occasionally has a fourth project active. It gets no brain and is not shown anywhere in the MAGI view. When one of the three brains frees, the most recently active of the queued projects takes it, so the project the developer touched last is the one that appears.

**Why this priority**: The developer has decided not to run more than three projects at once, so this is the uncommon path; it only needs to be predictable.

**Independent Test**: Feed fixture sessions for four or five active projects, free a brain, and check which queued project takes it.

**Acceptance Scenarios**:

1. **Given** three brains held, **When** a fourth project D becomes active, **Then** D takes no brain and the three brains are unchanged.
2. **Given** queued projects D (last active 10:05) and E (last active 10:07), **When** BALTHASAR frees, **Then** E takes BALTHASAR and D stays queued.
3. **Given** queued project D, **When** D becomes inactive before any brain frees, **Then** D leaves the queue and does not take a brain later unless it becomes active again.
4. **Given** the brain listing, **When** it is requested, **Then** it contains exactly three brains and never a queued project.

---

### User Story 5 - Start MAGI without a repo path (Priority: P1)

The developer starts the visualizer with no arguments, from any directory, and it shows whatever projects are active on the machine. Only one such instance runs at a time; starting a second one tells them where the first one is running.

**Why this priority**: Projects now come from sessions, so requiring a repo path is a leftover from 001 that makes no sense for MAGI.

**Independent Test**: Start the server with no path and a temporary state directory; check its health response, the instance record, the "already running" message on a second start, and the cleanup on shutdown.

**Acceptance Scenarios**:

1. **Given** no arguments, **When** the developer starts the visualizer, **Then** it starts, serves the MAGI listing and the UI, and prints the address it listens on.
2. **Given** a running instance started without a path, **When** a second one is started without a path, **Then** it exits with status 1 and a message naming the running instance's address.
3. **Given** an instance started without a path, **When** it is running, **Then** its instance record is at a fixed, documented location in the visualizer's state directory, separate from the per-repo instance records, and it is removed on clean shutdown.
4. **Given** a repo path, **When** the developer starts the visualizer with it, **Then** it starts as before (path validation, per-repo instance record and config lookup), and the brains still show the active projects on the machine, not only that repo.
5. **Given** no path, **When** the health endpoint is requested, **Then** it reports that no repo path was given instead of a repo path and name.
6. **Given** no path, **When** the developer opens the UI, **Then** the placeholder page loads without error.

### Edge Cases

- Two projects become active in the same poll (for example at startup, when existing sessions are read at once): they take brains in order of most recent activity, most recent first; ties are broken by project identity, so the result is the same on every run.
- A freed brain and a newly active project in the same step: the queued projects and the new project compete together, most recently active first.
- All main sessions in a project are older than the idle timeout when the visualizer starts: the project is not active and takes no brain.
- A session's last activity lies in the future (clock skew between files): it counts as live; the timeout is measured from its last activity.
- A session changes model (a main session switches to Sonnet, or the reverse): it counts only while the main-agent rule marks it as main.
- A brain's project has several worktrees: all worktrees are one project (004), so one brain.
- Session-ended sessions are not reported by the agent source (005) and so never count as live.
- A main session with a running subagent but no recent entry of its own: the subagent's activity counts as the session's activity (004), so it stays live while the subagent works.
- An invalid idle or waiting timeout in the config file (not a positive number): the visualizer refuses to start, with exit status 1 and a message naming the file and the setting, like other invalid config values.
- Restarting the visualizer: brain assignments are recomputed from the sessions on disk, so a project may land on a different brain than before the restart.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST have exactly three brains, in fixed order: MELCHIOR (number 1), BALTHASAR (number 2), CASPER (number 3).
- **FR-002**: A main session MUST count as live while the agent source reports it, it is a main session, and its last activity is no older than the idle timeout. The idle timeout MUST apply to `working` and `standby` sessions alike. A session that is `waiting` MUST instead use the waiting timeout, so a brain stays red through a long absence but a session that died mid-prompt still clears eventually.
- **FR-003**: The idle timeout MUST default to 30 minutes and the waiting timeout to 4 hours; both MUST be configurable in the visualizer's config file. An invalid value MUST stop startup with exit status 1 and a message naming the file and the setting.
- **FR-004**: A project MUST be active while it has at least one live main session. Projects are identified as in 004 (all worktrees of a repo are one project).
- **FR-005**: When a project becomes active and a brain is free, it MUST take the lowest-numbered free brain. It MUST keep that brain while it stays active; brains MUST NOT be reassigned or reordered while their projects stay active.
- **FR-006**: When a project stops being active, its brain MUST become free (state `not-active`, no project). Liveness MUST be re-evaluated over time, not only when new events arrive, so a timed-out project frees its brain within 5 seconds of its timeout passing. A waiting session that is answered after outliving the idle timeout is judged by the idle timeout again from its new activity.
- **FR-007**: An active project that finds no free brain MUST be queued: it holds no brain and is not shown. When a brain frees, the queued project with the most recent activity MUST take it. A queued project that stops being active MUST leave the queue.
- **FR-008**: When several projects compete for free brains in the same step, they MUST be served in order of most recent activity (most recent first), ties broken by project identity, so the outcome is deterministic.
- **FR-009**: A brain's state MUST be `not-active` when it has no project; otherwise, over the project's live main sessions only, `waiting` if any is waiting, else `working` if any is working, else `standby`.
- **FR-010**: Each brain MUST report when its current state began: the time of the session change that produced the state, or the time the brain took or lost its project if later. A brain that has been free since the visualizer started MUST report no time.
- **FR-011**: The server MUST expose a MAGI listing endpoint returning the three brains in order, each with its number, name, state, state-since time, and project (identity, display name and path) or no project. Queued projects MUST NOT appear in it.
- **FR-012**: The response types of the MAGI listing MUST be defined in the shared contract module, the only server module the UI may import, and that module MUST import nothing.
- **FR-013**: The visualizer MUST start without a repo path. With no path it MUST read its config file from the current directory only, and write its instance record at one fixed location in the state directory, separate from per-repo instance records; that location MUST be documented.
- **FR-014**: Only one path-less instance MUST run at a time: a second path-less start while one is live MUST exit with status 1 and a message naming the running instance's address. A record left by a dead instance MUST NOT block a new start.
- **FR-015**: With a repo path, startup MUST behave as before (path validation, per-repo instance record, config lookup in the repo then the current directory). The repo path MUST NOT limit which projects the brains show.
- **FR-016**: The health endpoint MUST report the repo path and name when one was given, and report their absence (rather than fail or invent values) when not. The UI placeholder page MUST load in both cases.
- **FR-017**: The slot logic MUST NOT write to any observed repo or transcript, and brain assignments MUST NOT be persisted; they are recomputed from the sessions after a restart.
- **FR-018**: Tests MUST be fixture-driven, using fixture sessions and a controllable clock, and MUST cover at least: lowest-free-brain assignment; no reshuffling when a lower brain frees; a second session in an already-assigned project; non-main sessions ignored; freeing by session end; freeing by idle timeout with no new events; a `waiting` session outlasting the idle timeout and freed by the waiting timeout; a stale `working` session timing out while another stays live; state combination and precedence; state-since times; a fourth project queued and the most recently active queued project taking a freed brain; deterministic order for simultaneous activation; an invalid timeout config (either setting); and path-less startup (instance record location, second-instance refusal, health without a path).

### Key Entities *(include if feature involves data)*

- **Brain**: number (1–3), name, state (`not-active`, `standby`, `working`, `waiting`), state-since time or none, assigned project or none.
- **Assigned project**: identity (as in 004), display name, path shown to the developer.
- **Queue**: active projects without a brain, ordered by most recent activity. Internal only.
- **Idle timeout**: duration after a `working` or `standby` main session's last activity at which it stops counting; default 30 minutes; set in the config file.
- **Waiting timeout**: the same for a session that is `waiting`; default 4 hours; set in the config file.
- **Path-less instance record**: the running instance's port, process ID, start time and version, at a fixed location in the state directory.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every fixture scenario in FR-018, each brain's project, state and state-since time after each step match the expected values in 100% of cases.
- **SC-002**: Across a fixture run in which projects become active and inactive in any order, no brain changes project while its project stays active.
- **SC-003**: A change in a session's state is reflected in the MAGI listing within 1 second, and a timed-out project's brain is free within 5 seconds of the timeout passing.
- **SC-004**: Running the same fixture inputs twice gives identical brain assignments.
- **SC-005**: A developer can start the visualizer with no arguments from any directory and see the MAGI listing at the printed address in under 10 seconds.
- **SC-006**: After a full test run, no fixture, transcript or observed repo file has been modified, and nothing has been written outside temporary directories and the visualizer's own state directory.

## Assumptions

- Session states, last-activity times, main-agent marking and session end come from the combined agent source of 004 and 005, unchanged. "Activity" is what 004 reports as a session's last activity, which includes its subagents' activity and (005) its waiting events.
- The idle timeout also resolves the follow-up from 004/005 where a crashed session stays `working`: after the timeout it stops counting, at the brain level. The session itself may still be reported as `working` by the sessions endpoint; changing 004's session state is out of scope.
- The project path shown for a brain is the repo's main working directory for git projects (the directory containing the git common dir), and the session's working directory outside git.
- With a repo path, the repo still only affects config lookup, the instance record and the health endpoint; the spec board and project view that would use it come after V1.
- One path-less instance per machine is enough: it already shows every project on the machine.
- Brain assignments are not saved across restarts; a restart may move projects to different brains. Saving them is revisited only if this bothers the developer in practice.
- Live pushing of brain changes to the UI is 007; the panel that draws the brains is 008. This spec only computes and serves the brains.
- The existing sessions endpoint stays as it is.
