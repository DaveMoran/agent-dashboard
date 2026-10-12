# Feature Seeds

Ready-to-paste prompts for `/speckit.specify`, in build order. Full context lives in `docs/master-spec.md`. Each seed is deliberately small so the Qwen coder gets short, explicit tasks.

Shared context to mention once in the constitution (not per seed): TypeScript strict, Bun runtime, `bun test`, React + Vite UI, read-only observer (never writes to the target repo).

---

## 001-server-skeleton
Build the project skeleton for Agent Visualizer, a local read-only web UI. A Bun + TypeScript server started with `agent-visualizer <repo-path>` validates that the path is a directory, loads an optional `agent-visualizer.config.json` (from the target repo or cwd), and serves a health endpoint at `/api/health` returning the repo path and version. A Vite + React app is served by the same server (dev proxy in development, static build in production) and shows a placeholder page with the repo name. Support a `--port` flag with automatic fallback to a free port if the default is taken. On startup, write a small `server.json` (port, PID, repo path, start time) into the visualizer's own state directory (never into the target repo), and remove it on clean shutdown, so other tools can discover a running instance. Include `bun run dev`, `bun run build`, and `bun test` scripts.

## 002-common-model-adapter-interface
Define the common spec model and adapter contract. Types: `Spec { id, title, status, dependsOn[], tasks[{id,text,done,phase?,parallel?}], artifacts[], branch? }`, status one of drafted | planned | ready | in-progress | review | done | blocked, and `Event { ts, role: planner|coder|human|git, specId?, kind, detail }`. Adapter interface: `detect(repo)`, `discover(repo)` (paths/globs to watch), `parse(files) -> Spec[]`. Add an adapter registry with auto-detection (config can force an adapter), and a debounced file watcher that re-runs the active adapter and emits a spec-changed notification. No concrete adapter yet; test with a stub adapter.

## 003-speckit-adapter
Implement the Spec Kit adapter. Detect `specs/NNN-feature/` directories. Derive status: only spec.md -> drafted; plus plan.md -> planned; plus tasks.md -> ready; some tasks checked -> in-progress; all checked -> review; feature branch merged into main -> done. Parse tasks.md checkboxes, task IDs, `[P]` parallel markers and phase headings. Take the title from spec.md. Use the `NNN-feature` branch name as `branch`. Add fixtures under `fixtures/speckit/` covering each status, and use this repo's own `specs/` as a live check.

## 004-transcript-ingester
Ingest Claude Code session transcripts for the target repo. Resolve the project slug (repo path with `/` replaced by `-`) under `~/.claude/projects/`, tail every `*.jsonl` there incrementally (track byte offsets, handle partial lines), and normalize entries into `Event`s: prompts, Edit/Write -> file-edit, Bash -> bash (flag test runs such as `bun test`), plus timestamp, session ID, model and `gitBranch`. Assign role by model ID using a configurable regex (default `claude-*` -> planner, `qwen*` -> coder). Expose "last activity per role" (timestamp of the most recent event for planner and coder, plus session ID) via an API endpoint such as `/api/activity`, so external tools can check whether both sessions are alive. Test against a recorded sample JSONL in `fixtures/transcripts/`.

## 005-git-ingester-attribution
Read git history and branches of the target repo (shelling out to `git`, read-only) and emit commit events with their `[spec-NNN]` tag if present. Implement the attribution pipeline that assigns each event a `specId`, in order: transcript `gitBranch` matching a spec's branch -> spec ID mentioned in the prompt or commit message -> edited file path inside the spec's artifacts -> time window between that spec's status transitions. Unattributed events stay `specId: undefined`. Unit test each rule separately.

## 006-live-updates
Add an SSE endpoint `/api/stream` that pushes spec snapshots and new events as they change, with an initial full snapshot on connect and `Last-Event-ID` resume. On the client, add a small store (React context or zustand) that consumes the stream, reconnects automatically and exposes `specs` and `events`. Show a connection-status indicator in the UI shell.

## 007-spec-board
Build the spec board view. Columns per status, with cards showing spec ID, title, task progress ("6/9" plus a bar), and a ready/blocked highlight (blocked when a dependency is not done). A card pulses briefly when the coder has produced an event for that spec in the last 30 seconds. Clicking a card navigates to that spec's detail route (the timeline lands in 009). Responsive, keyboard-navigable, light and dark theme.

## 008-dependency-graph
Add a toggle on the board to switch to a dependency graph using React Flow: nodes are specs colored by status, edges follow `dependsOn`, auto-layout left to right, with minimap and fit-to-view. Specs with no dependency data render as unconnected nodes. Clicking a node behaves like clicking a board card.

## 009-spec-timeline
Build the per-spec timeline at `/spec/:id`. Two horizontal swimlanes, planner and coder, on a shared time axis. Plot events: spec created or revised, status changes, task checked, file edits, test runs (pass/fail where detectable), commits. Clicking an event opens a detail drawer with the file path, command, or prompt excerpt. Include a summary header (status, tasks done, elapsed time since in-progress, number of test failures).

## 010-plain-markdown-adapter
Implement the plain-markdown adapter. Detect `specs/NNN-slug.md` files with YAML frontmatter (`id`, `title`, `status`, `depends_on`, `updated`). Map frontmatter status to the common model, parse checkbox tasks in the body, and report validation warnings for missing or unknown fields. Fixtures under `fixtures/plain/`.

## 011-openspec-adapter
Implement the OpenSpec adapter. Detect `openspec/changes/<id>/` with proposal.md and tasks.md; changes moved to `openspec/changes/archive/` are done. Status from presence of artifacts and task checkbox progress. Title from the proposal heading. Fixtures under `fixtures/openspec/`.

## 012-bmad-adapter
Implement the BMAD adapter. Detect BMAD artifacts (PRD, architecture, epics, and story files, typically under `docs/` or a configured folder). Treat each story file as a spec, reading its `Status:` field (e.g. Draft, Approved, InProgress, Review, Done) and mapping it to the common status; group stories by epic via the epic number in the filename or heading; parse story task checkboxes. Fixtures under `fixtures/bmad/`.
