# Research: MAGI Slots

No open clarifications remain in the spec (FR-002 was resolved as option C: a separate waiting timeout). This file records the design decisions the spec left to the plan.

## R1. Where the path-less instance record lives

**Decision**: `<state-root>/magi/server.json`, where `<state-root>` is `~/.agent-visualizer/` or `AGENT_VISUALIZER_STATE_DIR`. The record has the same shape as a per-repo record, with `repoPath: null`. Per-repo records stay at `<state-root>/instances/<repo-key>/server.json`.

**Rationale**: the path-less instance is a single instance per machine, so it gets one fixed path. Keeping it outside `instances/` means it can never collide with a repo key, and a tool looking for "the MAGI server" has exactly one file to read. The same atomic write (temp file + rename), the "only remove if the pid matches" cleanup and the liveness check (`kill -0` plus `/api/health`) are reused. `isLive` already compares the health `repoPath` with the record's, and `null === null` holds for the path-less case.

**Alternatives considered**: `<state-root>/server.json` (top level): mixes the record with `hooks/` and future state, and is less obvious to find. `instances/magi/server.json`: lives among repo keys, so it reads as if it were a repo called "magi".

## R2. Timeouts and config keys

**Decision**: two new optional keys in `agent-visualizer.config.json`: `idleTimeoutMinutes` (default 30) and `waitingTimeoutMinutes` (default 240). Each must be a finite number greater than 0, and fractions are allowed (for example `0.5`). Any other value throws `ConfigValueError` (exit 1), with the message `Invalid config in <file>: "<key>" must be a positive number of minutes, got <json>`. A session is live while `now - lastActivity <= timeout`, where the timeout is the waiting timeout if the session's state is `waiting` and the idle timeout otherwise.

**Rationale**: minutes match how the developer thinks about the setting. Fractions let tests and the live check use short timeouts. The message follows the pattern of the existing config checks.

**Alternatives considered**: milliseconds (unfriendly in a config file); a single setting with a multiplier for waiting (harder to explain); a CLI flag (the seed asks for config only, and flags can come later).

**Consequence**: a session that is answered after outliving the idle timeout gets fresh activity from the answer, so the idle rule applies again from then (spec FR-006). Because 005 counts the waiting event as activity, the waiting timeout runs from when the wait began, or from later activity.

## R3. Evaluation model: a pure step plus a ticking service

**Decision**:
- `src/magi/slots.ts` exports a pure function `stepSlots(prev, sessions, nowMs, options) → SlotState`. It has no I/O, no timers and no `Date.now`. All assignment, queueing, state combination and since rules live here.
- `src/magi/service.ts` exports `createMagiService({ source, idleMs, waitingMs, now?, tickMs? })`. It runs `stepSlots` on every agent-source event and on a timer every `tickMs`, which defaults to 1000 ms. It exposes `brains()`, `start()`, `stop()` and `refresh()` (a step now, for tests).

**Rationale**: a pure step makes every spec scenario a table test with a fake clock (FR-018), and keeps the slot logic separate from the source. The timer makes freeing on timeout happen without new events (FR-006). A 1 s tick frees a brain within about 1 s of its timeout, well inside the 5 s budget, at negligible cost (three brains, about ten sessions).

**Alternatives considered**: scheduling one timer for the next expiry (more code and the same effect); computing the brains on each HTTP request (would lose the "no reshuffling" memory between requests and the state-since times).

## R4. Assignment and queue order

**Decision**: in each step:
1. Drop non-live sessions. Group the live main sessions by `projectId` to get the active projects. A project's activity is the maximum `lastActivity` among its live main sessions.
2. Free each brain whose project is no longer active.
3. Keep each brain whose project is still active. Assignments are never moved.
4. Order the active projects without a brain by activity, newest first, with ties broken by `projectId` ascending. Assign them in that order to the free brains, lowest number first, until the brains run out. The rest are queued, which is implicit: the queue is just "active and unassigned" and is never stored.

**Rationale**: this one rule covers the first project (lowest free brain), a queued project taking a freed brain (most recently active first, spec FR-007) and simultaneous activation (FR-008, deterministic). Because the queue is recomputed every step, a project that stops being active leaves it automatically.

**Alternatives considered**: a first-come FIFO queue: it contradicts the seed, which says the most recently active project takes a freed brain. Storing the queue explicitly: extra state for no behavior.

## R5. State-since rule

**Decision**: a brain's `stateSince` changes only when its state or project changes in a step. It is then set to:
- **Freed**: the time the project stopped being active, which is the latest drop time among its sessions that dropped this step. A session that is still in `sessions()` but no longer live (it timed out, or is no longer main) drops at its expiry, `lastActivity + timeout`, capped at `now`. A session that disappeared from the source (it ended) drops at `now`, because the source does not keep the end time in `sessions()`, and the 500 ms poll keeps the error small.
- **Took a project**: the latest `stateSince` among the project's live main sessions that are in the brain's new state, or `now` if none has one. That value is then raised to `now`, except on the service's first step after start: there, the brain's history is the sessions' own history, so a project that has been working since 09:50 shows "working since 09:50", not "since the visualizer started".
- **State changed, same project**: the latest `stateSince` among live main sessions in the new state, raised to the latest drop time this step (a session that timed out at `lastActivity + timeout`, or ended at `now`). It is never earlier than the brain's previous `stateSince`.
- A brain that has been free since start has `stateSince: null`.

**Rationale**: it follows spec FR-010 (the session change that produced the state, or the take/free time if later), it is deterministic under a fake clock, and it gives sensible values when a stale `working` session drops out: the brain shows standby since the drop, not since the other session's old standby time. The first-step exception keeps startup values meaningful.

**Alternatives considered**: always use `now` (wrong after every restart, since everything would be "since just now"); the earliest `stateSince` in the state (wrong when sessions alternate, because the brain was not continuously in that state).

## R6. Project path and name

**Decision**: the brain's project is `{ id, name, path }`, where `id` and `name` are the 004 project identity and name, and `path = basename(id) === ".git" ? dirname(id) : id`. This is a pure helper, `projectPath(id)`, in `src/magi/slots.ts`.

**Rationale**: the 004 id is the git common dir (`/repo/.git`) for git projects, and the `cwd` outside git. The repo's main working directory is the path the developer recognizes. For a bare-repo setup, the common dir itself is the best path available.

**Alternatives considered**: carrying `inGit` through `AgentSession` (an interface change for a one-line derivation).

## R7. Health and UI without a repo path

**Decision**: `HealthResponse.repoPath` and `repoName` become `string | null`. The routes take `repo: RepoTarget | null`. The UI placeholder shows "MAGI" as its heading when `repoName` is null, and leaves out the path line.

**Rationale**: it reports the absence rather than inventing a value (FR-016), keeps `isLive` working unchanged, and keeps the UI change minimal until 008 replaces the page.

**Alternatives considered**: leaving out the fields (consumers would need an `in` check, and the old 001 test assumptions would break silently); empty strings (indistinguishable from a bug).

## R8. Config lookup and CLI without a path

**Decision**: `loadConfig(repoPath: string | undefined, cwd)` searches `[repoPath, cwd]` when a path is given, and `[cwd]` when not. `parseCliArgs` no longer requires the positional argument, and more than one positional is still a usage error (exit 2). The usage text becomes `agent-visualizer [<repo-path>] [--port <n>]`. With no path, the startup output prints `Observing: all Claude Code projects` in place of the repo path. With no path, the "already running" error reads `Agent Visualizer is already running at http://127.0.0.1:<port>`.

**Rationale**: these are the smallest changes to the 001 behavior that meet FR-013 to FR-015. A given path keeps every existing behavior and test.

**Alternatives considered**: dropping the path argument entirely (would break 001's tests and documented behavior for no gain in V1); a config file in the state directory (not asked for, and can be added later).

## R9. No persistence, one service per process

**Decision**: brain assignments live only in memory. The service is created in `src/cli/index.ts` after the agent source starts, and stopped before it. `/api/magi` reads `service.brains()`. Without a service (as in existing route tests), it returns three free brains.

**Rationale**: spec FR-017 and its assumption. Persisting would add writes and a stale-state problem for little value.
