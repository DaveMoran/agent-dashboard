# Feature Seeds

Ready-to-paste prompts for `/speckit.specify`, in build order. Full context lives in `docs/master-spec.md`. Each seed is deliberately small so the coder gets short, explicit tasks. Seeds 001–003 are shipped and kept as written; 004 onward were reshaped for MAGI (see the master spec). V1 is 004–008; the "Later" section holds the rest.

Shared context to mention once in the constitution (not per seed): TypeScript strict, Bun runtime, `bun test`, React + Vite UI, read-only observer (never writes to an observed repo), desktop only (1024px minimum width).

---

## 001-server-skeleton
Build the project skeleton for Agent Visualizer, a local read-only web UI. A Bun + TypeScript server started with `agent-visualizer <repo-path>` validates that the path is a directory, loads an optional `agent-visualizer.config.json` (from the target repo or cwd), and serves a health endpoint at `/api/health` returning the repo path and version. A Vite + React app is served by the same server (dev proxy in development, static build in production) and shows a placeholder page with the repo name. Support a `--port` flag with automatic fallback to a free port if the default is taken. On startup, write a small `server.json` (port, PID, repo path, start time) into the visualizer's own state directory (never into the target repo), and remove it on clean shutdown, so other tools can discover a running instance. Include `bun run dev`, `bun run build`, and `bun test` scripts.

## 002-common-model-adapter-interface
Define the common spec model and adapter contract. Types: `Spec { id, title, status, dependsOn[], tasks[{id,text,done,phase?,parallel?}], artifacts[], branch? }`, status one of drafted | planned | ready | in-progress | review | done | blocked, and `Event { ts, role: planner|coder|human|git, specId?, kind, detail }`. Adapter interface: `detect(repo)`, `discover(repo)` (paths/globs to watch), `parse(files) -> Spec[]`. Add an adapter registry with auto-detection (config can force an adapter), and a debounced file watcher that re-runs the active adapter and emits a spec-changed notification. No concrete adapter yet; test with a stub adapter.

## 003-speckit-adapter
Implement the Spec Kit adapter. Detect `specs/NNN-feature/` directories. Derive status: only spec.md -> drafted; plus plan.md -> planned; plus tasks.md -> ready; some tasks checked -> in-progress; all checked -> review; feature branch merged into main -> done. Parse tasks.md checkboxes, task IDs, `[P]` parallel markers and phase headings. Take the title from spec.md. Use the `NNN-feature` branch name as `branch`. Add fixtures under `fixtures/speckit/` covering each status, and use this repo's own `specs/` as a live check. The planner and coder may work in different git worktrees of the same repo, so discover specs in every worktree (see 005 for how to list them): the same `NNN-feature` directory may exist in several worktrees, and the copy in the worktree whose checked-out branch is that feature's branch is authoritative. A spec that exists only in the planner's worktree (not yet merged) must still appear on the board.


## 004-session-ingester
Read Claude Code session transcripts from every project folder under `~/.claude/projects/` and work out which agents are active and what they are doing. Tail every session `*.jsonl` incrementally (track byte offsets, handle partial lines) and read from each entry only what V1 needs: timestamp, session ID, model, `cwd`, and whether the entry is a user prompt, a tool call, a tool result or a final assistant reply. Group sessions into projects: a project is the git common dir of the session's `cwd` (so all worktrees of one repo are one project), or the `cwd` itself outside git. A session is a "main agent" session when its model matches a configurable regex (default `^claude-(opus|fable)`); only main-agent sessions count in V1. Derive each main session's state from the transcript alone: working (a prompt or tool call has no final assistant reply yet; a running subagent counts, since its tool call is still open) or standby (the last turn ended). "Waiting" comes in 005. Put this behind a small "agent source" interface (sessions and their state changes) so the hook source (005) and a future Agent SDK source plug in without changing consumers. Expose `/api/sessions` (projects, their main sessions, each session's state and last activity). Test against recorded sample JSONL in `fixtures/transcripts/`, including a turn that runs a subagent and a project with two worktrees.

## 005-attention-hook
Add the opt-in attention hook, so a brain can show red when an agent is waiting for the user. Provide a small hook script plus documented settings that the user adds to their own user-level Claude Code settings (the visualizer never installs or edits hooks or settings). The hook appends one JSON line per event (timestamp, session ID, `cwd`, event name and type) to a file in the visualizer's state directory, never in an observed repo. Research which Claude Code hook events mark "waiting for the user" and "done waiting" (for example the `Notification` permission and idle prompts, `PermissionRequest`, `UserPromptSubmit`, `Stop`, `SessionEnd`) and record the mapping. Add a hook-backed agent source that reads this file incrementally and combines with the 004 transcript source: a session is waiting from a waiting event until the next prompt, tool result or stop; `SessionEnd` ends the session. Without the hook installed everything still works and nothing is ever red. Fixture-driven tests for the state combination, including events that arrive out of order.

## 006-magi-slots
Assign projects to the three MAGI brains. Brains, in order: MELCHIOR (1), BALTHASAR (2), CASPER (3). When a project's first main-agent session becomes active, the project takes the lowest free brain and keeps it while it stays active (no reshuffling). A brain is freed, back to not active, when all of its project's main sessions have ended or been idle longer than a configurable timeout (default 30 minutes). A fourth active project gets no brain and is not shown; when a brain frees, the most recently active waiting project takes it. Brain state: not active (no project), waiting (any main session waiting), working (any main session working), otherwise standby. `agent-visualizer` now starts without a repo path (a path is no longer required); decide and document where `server.json` lives in that case. Expose `/api/magi` (three brains, each with state, project path and name, and when the state last changed); define its response types in `src/contract/`, the only server module the UI may import. Tests use fixture sessions.

## 007-live-updates
Add an SSE endpoint `/api/stream` that pushes the three brain states as they change, with an initial full snapshot on connect and `Last-Event-ID` resume. On the client, add a small store (React context or zustand) that consumes the stream, reconnects automatically and exposes `brains`. Stream message types live in `src/contract/`; the UI imports nothing else from the server. Show a connection-status indicator in the UI shell.

## 008-magi-panel
Build the MAGI panel, the app's only screen in V1, styled after the MAGI display from Neon Genesis Evangelion: three angular panels labelled MELCHIOR•1, BALTHASAR•2 and CASPER•3 around a central MAGI label, on a dark background with orange-red framing. Each panel shows its brain's state: not active is black with red lettering; standby is green; working pulses slowly between green and blue (one full cycle every 2 seconds or slower, a smooth fade and never a flash); waiting is red. Every panel also shows its state as text and its project name, so state never depends on colour alone, and under `prefers-reduced-motion` the working pulse becomes a steady colour. Panels are display only in V1 (no click-through). Desktop only (1024px minimum width), live from the 007 store.

---

# Later (after V1)

Not numbered yet; each gets the next free number when it is picked up. V1 ends at 008.

## project-view
Clicking a brain opens its project at `/brain/:n`: the project's main sessions and their subagents (model, state, last activity, live feed of recent events), and the spec board: columns per status, cards with spec ID, title, task progress ("6/9" plus a bar) and a ready/blocked highlight (blocked when a dependency is not done), and a brief pulse on specs touched in the last 30 seconds. Needs: the auto-detected spec adapter run per occupied brain (all worktrees, 003 root resolution), stopped when the brain frees; subagent transcripts read and attached to their parent session; transcript entries normalized into events (prompt, file-edit, bash, test-run) with session, agent (main/subagent) and model fields replacing the 002 `role` field. Desktop only, keyboard-navigable, light and dark theme.

## git-ingester-attribution
Read git history and branches of each project on a brain (shelling out to `git`, read-only, reusing `src/git/` from 003). Emit commit events with their `[spec-NNN]` tag if present. Implement the attribution pipeline that assigns each event a `specId`, in order: transcript `gitBranch` matching a spec's branch -> spec ID mentioned in the prompt or commit message -> edited file path inside the spec's artifacts -> time window between that spec's status transitions. Unattributed events stay `specId: undefined`. Unit test each rule separately.

## dependency-graph
Add a toggle on the board to switch to a dependency graph using React Flow: nodes are specs colored by status, edges follow `dependsOn`, auto-layout left to right, with minimap and fit-to-view. Specs with no dependency data render as unconnected nodes. Clicking a node behaves like clicking a board card.

## spec-timeline
Build the per-spec timeline at `/brain/:n/spec/:id`. Swimlanes on a shared time axis: one for the main agent sessions, one per subagent type, one for git. Plot events: spec created or revised, status changes, task checked, file edits, test runs (pass/fail where detectable), commits. Clicking an event opens a detail drawer with the file path, command, or prompt excerpt. Include a summary header (status, tasks done, elapsed time since in-progress, number of test failures).

## plain-markdown-adapter
Implement the plain-markdown adapter. Detect `specs/NNN-slug.md` files with YAML frontmatter (`id`, `title`, `status`, `depends_on`, `updated`). Map frontmatter status to the common model, parse checkbox tasks in the body, and report validation warnings for missing or unknown fields. Fixtures under `fixtures/plain/`.

## openspec-adapter
Implement the OpenSpec adapter. Detect `openspec/changes/<id>/` with proposal.md and tasks.md; changes moved to `openspec/changes/archive/` are done. Status from presence of artifacts and task checkbox progress. Title from the proposal heading. Fixtures under `fixtures/openspec/`.

## bmad-adapter
Implement the BMAD adapter. Detect BMAD artifacts (PRD, architecture, epics, and story files, typically under `docs/` or a configured folder). Treat each story file as a spec, reading its `Status:` field (e.g. Draft, Approved, InProgress, Review, Done) and mapping it to the common status; group stories by epic via the epic number in the filename or heading; parse story task checkboxes. Fixtures under `fixtures/bmad/`.
