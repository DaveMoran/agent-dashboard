# Agent Visualizer — Master Plan

## Context
Every repo will run two Claude Code instances side by side:
- **Planner** — Claude in plan mode, writes specs.
- **Coder** — Qwen (30B+ coder) via Ollama, driven through Claude Code (`ANTHROPIC_BASE_URL` → Ollama), implements specs.

They hand off through spec files on disk. With ~20 specs per app it's hard to see what's planned, what's being built, what's blocked, and how a given spec actually went. **Agent Visualizer** is a small local web UI that *observes* (read-only in v1) the planner/coder pair for one repo and shows the spec pipeline plus a per-spec history. It must be **SDD-framework agnostic** (plain markdown, Spec Kit, OpenSpec, BMAD).

The tool is **dogfooded**: built with the same Claude-planner + Qwen-coder pair using **Spec Kit**, so its own repo is the first live fixture.

## Decisions
| Area | Decision |
|---|---|
| Role | Observe only (no orchestration) |
| Scope | Single repo per run (`agent-visualizer <repo-path>`); fleet view later |
| Stack | TypeScript, Bun server, React + Vite UI, React Flow for DAG, SSE for live updates |
| Views | Spec board/graph, per-spec timeline |
| Build framework | Spec Kit (user familiar; 30B+ coder can follow it); constitution kept to a few lines |
| Adapters | Spec Kit first (end-to-end with both views), then Plain-markdown, OpenSpec, BMAD |
| Attribution | Spec status transitions + `[spec-NNN]` commit tags + git branch |
| Spec location | Owned per adapter (auto-detected), overridable in config |
| Coder model | Claude Sonnet is the coder for open-ended tasks. A local Qwen3-Coder-30B (Ollama) handled small explicit edits but shipped stubs and misreported progress on multi-step tasks, so it is limited to narrow, test-backed work. Spec 001 was built with Sonnet |
| Worktrees | Planner and coder may run in separate git worktrees of one repo (so each can be on its own branch at the same time). The visualizer treats all worktrees of a repo as one project (identified by the git common dir) and merges their specs and transcripts. Handled in specs 003-005. |
| Default port | `4317`; `--port` > `agent-visualizer.config.json` > default. If taken, fall back to a free port and say so |
| State directory | `~/.agent-visualizer/instances/<repo-key>/server.json` (override root with `AGENT_VISUALIZER_STATE_DIR`); never inside the observed repo. The upcoming double-agent launcher skill reads `server.json` to find a running instance |
| Network binding | Loopback only (`127.0.0.1`) |
| Dev mode | `bun run dev` runs Vite and the Bun server; the Bun server proxies HTTP to Vite and Vite's HMR WebSocket connects directly to the Vite port (5173) |

## Architecture
```
repo ──► Adapters (Spec Kit | Plain | OpenSpec | BMAD) ──┐
~/.claude/projects/<slug>/*.jsonl ──► Transcript ingester ─┼─► Event store (in-memory) ─► SSE ─► React UI
git log / branches ──► Git ingester ───────────────────────┘
```

**Common model** (what every adapter maps to):
- `Spec { id, title, status, dependsOn[], tasks[{id, text, done, phase?, parallel?}], artifacts[paths], branch? }`
- `status ∈ drafted | planned | ready | in-progress | review | done | blocked`
- `Event { ts, role: planner|coder|human|git, specId?, kind: spec-created|status-change|task-checked|file-edit|bash|test-run|commit|prompt, detail }`

**Adapter contract:** `detect(repo) → bool`, `discover(repo) → paths/globs to watch`, `parse(files) → Spec[]`. Status derivation per framework:
- *Spec Kit:* `specs/NNN-feature/` — spec.md only → drafted; +plan.md → planned; +tasks.md → ready; some boxes checked → in-progress; all checked → review; branch merged → done. Feature branch `NNN-feature` gives attribution for free.
- *Plain markdown:* `specs/NNN-slug.md` frontmatter `status`, `depends_on`.
- *OpenSpec:* `openspec/changes/<id>/` (proposal.md, tasks.md); moved to archive → done.
- *BMAD:* story files' `Status:` field (+ sprint status file if present); epics → grouping.

**Transcript ingester:** tails JSONL for the repo's project slug; role by model ID (configurable regex, default `claude-*` → planner, `qwen*` → coder); records tool calls (Edit/Write → file-edit, Bash → bash/test-run), prompts, `gitBranch`, timestamps.

**Attribution order:** git branch on transcript entry → spec ID mentioned in prompt/commit → edited files ∈ spec's artifact/likely-files → time window between status transitions.

## Views (v1)
- **Spec board:** status columns, task progress bar ("6/9"), blocked/ready highlighting, live pulse on the spec the coder is touching. Toggle to **dependency graph** (React Flow).
- **Per-spec timeline:** planner and coder swimlanes; spec authored/revised, status changes, task checks, file edits, test runs (pass/fail if detectable), commits; click event → detail drawer (diff path, command, prompt excerpt).

## Deliverables of the planning phase (what happens after approval)
**Acceptance criteria for this session = specs only.** No app code or scaffolding; the skeleton is feature 001, built by the planner/coder pair (validates the pipeline on an easy spec).
1. Write this as `docs/master-spec.md` in `/Users/moda/Sites/agent-visualizer`, `git init`.
2. User runs `specify init` (Spec Kit) in the repo; short constitution (TS strict, Bun, tests with `bun test`, small tasks for the Qwen coder).
3. Produce the ordered feature list below as ready-to-paste `/speckit.specify` seed prompts in `docs/feature-seeds.md`, so the planner can generate each spec.

## Feature specs (Spec Kit features, in build order)
1. **001-server-skeleton** — Bun server, CLI arg for repo path, config file, health endpoint, Vite React shell.
2. **002-common-model-adapter-interface** — types, adapter registry, auto-detect, file watcher with debounce.
3. **003-speckit-adapter** — status derivation above; fixture: this repo.
4. **004-transcript-ingester** — slug resolution, JSONL tailing, role detection, event normalization.
5. **005-git-ingester-attribution** — log/branch reading, attribution pipeline.
6. **006-live-updates** — SSE stream, client store.
7. **007-spec-board** — board + progress + live pulse.
8. **008-dependency-graph** — React Flow DAG view.
9. **009-spec-timeline** — swimlanes + detail drawer.
10. **010-plain-markdown-adapter**
11. **011-openspec-adapter**
12. **012-bmad-adapter**

Later (not v1): hooks for lower-latency events, multi-repo fleet view, metrics (time/tokens per spec, stall/loop detection), orchestration controls.

## Verification
- Unit: each adapter tested against a fixture repo under `fixtures/<framework>/` (`bun test`); transcript ingester against a recorded sample JSONL.
- End-to-end: run `bun run dev -- /Users/moda/Sites/agent-visualizer`, open the UI, confirm the board reflects the repo's own Spec Kit specs; tick a box in a `tasks.md` and confirm the card updates live; run a coder session and confirm its edits appear in that spec's timeline coder lane.
- Dogfood check: by feature 009, the visualizer should accurately show its own build history.
