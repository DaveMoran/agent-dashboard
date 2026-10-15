# Agent Visualizer — Master Plan

## Context
Agent Visualizer is a small local web UI, styled after the MAGI from Neon Genesis Evangelion, that shows up to three Claude Code projects at once. Each project gets one of three "brains": MELCHIOR•1, BALTHASAR•2 and CASPER•3. A brain shows whether its project's agents are on standby, ready, working or waiting for the user. Clicking a brain opens that project: its sessions and subagents, its spec pipeline and a per-spec history.

The working setup it is built around: a main agent (Claude Opus or Fable) per project, which hands implementation to Claude Sonnet subagents. Projects use a spec-driven framework, so the tool stays **SDD-framework agnostic** (plain markdown, Spec Kit, OpenSpec, BMAD).

V1 only *observes* Claude Code. Controlling agents (talking to a brain, answering its prompts) comes later through the Claude Agent SDK, together with a hardware controller: a microphone with three buttons, one per brain.

The tool is **dogfooded**: built with Spec Kit, so its own repo is the first live fixture.

## Decisions
| Area | Decision |
|---|---|
| Role | Observe only in V1 (no orchestration). Control comes with the Agent SDK pivot (see Later) and needs a constitution amendment |
| Scope | Up to three projects at once, one per brain. Projects are found from active Claude Code sessions; repo paths on the command line pin projects to brains. A fourth active project is not shown |
| Brains | MELCHIOR (1), BALTHASAR (2), CASPER (3). A project takes the lowest free brain when its first main-agent session becomes active and keeps it while active; it is freed after all its main sessions end or idle past a timeout (default 30 min). No reshuffling |
| Project | The git common dir of a session's `cwd` (all worktrees of a repo are one project), or the `cwd` itself outside git |
| Main agent | A session whose model matches a configurable regex (default `^claude-(opus|fable)`). Only main agents light up a brain; subagents and other sessions show inside their project |
| Brain states | standby (no project): black, red lettering; ready: green; working: slow green↔blue pulse (≥ 2 s per cycle, steady under reduced motion); waiting for the user: red. Always shown as text too. Combined over the project's sessions: waiting > working > ready |
| Waiting detection | Transcripts give working/ready. "Waiting" needs the opt-in attention hook, which the user installs in their own Claude Code settings and which writes only to the visualizer's state directory. Without it nothing is red |
| Agent sources | Session data comes through an "agent source" interface: transcripts (004), attention hook (005), later the Agent SDK |
| Platform | Desktop only, minimum width 1024px |
| Stack | TypeScript, Bun server, React + Vite UI, React Flow for DAG, SSE for live updates |
| Views | MAGI panel (home) → project view (sessions + spec board/graph) → per-spec timeline |
| Build framework | Spec Kit (user familiar; the coder can follow it); constitution kept to a few lines |
| Adapters | Spec Kit first, then Plain-markdown, OpenSpec, BMAD |
| Attribution | Spec status transitions + `[spec-NNN]` commit tags + git branch |
| Spec location | Owned per adapter (auto-detected), overridable in config |
| Coder model | Claude Sonnet. From 004 on it runs as subagents of the main (Opus) session, matching the setup the tool visualizes. A local Qwen3-Coder-30B (Ollama) handled small explicit edits but shipped stubs and misreported progress on multi-step tasks; specs 001–003 were built with Sonnet as a separate session |
| Worktrees | One project can span several git worktrees (identified by the git common dir); specs and transcripts from all of them are merged. Spec Kit handles this in 003 |
| Git access | Read-only `git` subprocesses (`rev-parse`, `worktree list --porcelain`, `symbolic-ref`, `show`) with `GIT_OPTIONAL_LOCKS=0`, in `src/git/` |
| Spec Kit worktree copies | The copy in the worktree that has the feature branch checked out wins; otherwise the path the user gave, then git's worktree order. A merged feature takes its tasks from `main` |
| Watching | Recursive watch per root, filtered by adapter patterns; 150 ms quiet period, 2 s maximum delay; full snapshot per notification |
| Default port | `4317`; `--port` > `agent-visualizer.config.json` > default. If taken, fall back to a free port and say so |
| State directory | `~/.agent-visualizer/` (override with `AGENT_VISUALIZER_STATE_DIR`); never inside an observed repo. Per-repo instances use `instances/<repo-key>/server.json`; the no-path MAGI instance's location is decided in 006 |
| Network binding | Loopback only (`127.0.0.1`) |
| Dev mode | `bun run dev` runs Vite and the Bun server; the Bun server proxies HTTP to Vite and Vite's HMR WebSocket connects directly to the Vite port (5173) |

## Architecture
```
~/.claude/projects/*/*.jsonl ──► Transcript source ─┐
attention hook log ───────────► Hook source ───────┼─► Sessions + states ─► Brain slots (≤ 3 projects)
                                                    │                              │
project repos ──► Adapters (Spec Kit | Plain | OpenSpec | BMAD) ─────────────────┤
git log / branches ──► Git ingester + attribution ───────────────────────────────┴─► Store ─► SSE ─► React UI
```

**Common model** (what every adapter maps to):
- `Spec { id, title, status, dependsOn[], tasks[{id, text, done, phase?, parallel?}], artifacts[paths], branch? }`
- `status ∈ drafted | planned | ready | in-progress | review | done | blocked`
- `Event { ts, sessionId?, agent: main|subagent|human|git, model?, specId?, kind: spec-created|status-change|task-checked|file-edit|bash|test-run|commit|prompt, detail }` (replaces the planner/coder `role` in 004)

**Adapter contract:** `detect(repo) → bool`, `discover(repo) → paths/globs to watch`, `parse(files) → Spec[]` (details in [`adapters.md`](adapters.md)). Status derivation per framework:
- *Spec Kit:* `specs/NNN-feature/` — spec.md only → drafted; +plan.md → planned; +tasks.md → ready; some boxes checked → in-progress; all checked → review; fully ticked tasks.md on main → done (covers merge, squash and deleted branches). Feature branch `NNN-feature` gives attribution for free.
- *Plain markdown:* `specs/NNN-slug.md` frontmatter `status`, `depends_on`.
- *OpenSpec:* `openspec/changes/<id>/` (proposal.md, tasks.md); moved to archive → done.
- *BMAD:* story files' `Status:` field (+ sprint status file if present); epics → grouping.

**Transcript source:** tails every session JSONL under `~/.claude/projects/`, including subagent transcripts; groups sessions into projects; records prompts, tool calls (Edit/Write → file-edit, Bash → bash/test-run), model, `cwd`, `gitBranch`, timestamps.

**Attribution order:** git branch on transcript entry → spec ID mentioned in prompt/commit → edited files ∈ spec's artifact/likely-files → time window between status transitions.

## Views (v1)
- **MAGI panel (home):** three brains with their state, project name and state text.
- **Project view:** the project's main sessions and subagents with state and a live feed; spec board with status columns, task progress ("6/9"), blocked/ready highlighting and a pulse on recently touched specs; toggle to **dependency graph** (React Flow).
- **Per-spec timeline:** swimlanes for main agent, each subagent type and git; spec authored/revised, status changes, task checks, file edits, test runs (pass/fail if detectable), commits; click event → detail drawer.

## Feature specs (Spec Kit features, in build order)
1. **001-server-skeleton** — Bun server, CLI arg for repo path, config file, health endpoint, Vite React shell. *(shipped)*
2. **002-common-model-adapter-interface** — types, adapter registry, auto-detect, file watcher with debounce. *(shipped)*
3. **003-speckit-adapter** — status derivation above, worktrees, merged rule. *(shipped)*
4. **004-transcript-ingester** — all projects' JSONL incl. subagents, sessions → projects, main-agent rule, working/ready, agent-source interface.
5. **005-attention-hook** — opt-in hook script and hook source for the waiting state.
6. **006-magi-slots** — brain assignment and lifecycle, per-project spec scans, optional repo path.
7. **007-git-ingester-attribution** — log/branch reading per project, attribution pipeline.
8. **008-live-updates** — SSE stream (brains, specs, events), client store.
9. **009-magi-panel** — home screen.
10. **010-project-view** — sessions/subagents strip + spec board.
11. **011-dependency-graph** — React Flow DAG view.
12. **012-spec-timeline** — swimlanes + detail drawer.
13. **013-plain-markdown-adapter**
14. **014-openspec-adapter**
15. **015-bmad-adapter**

Seeds for each are in [`feature-seeds.md`](feature-seeds.md).

## Later (not v1)
- **Agent SDK mode** (planned for when the hardware is ready): the visualizer hosts brains through the Claude Agent SDK, so "waiting" is exact and the user can talk to a brain and answer its prompts from the UI. The transcript and hook sources stay for Claude Code sessions. Needs a constitution amendment (control features, and network calls to the Anthropic API). Check SDK authentication and billing first.
- **Brain API:** local endpoints to send a message to a brain, read what it is waiting on and get a short summary; the hardware is a client of it.
- **Hardware controller:** a microphone with three buttons, one per brain. Press a button and speak to send that brain a message; tap a red brain to hear what it is waiting on.
- Metrics (time and tokens per spec, stall and loop detection).

## Verification
- Unit: each adapter tested against a fixture repo under `fixtures/<framework>/` (`bun test`); transcript and hook sources against recorded samples in `fixtures/`.
- End-to-end: start `agent-visualizer`, start an Opus session in this repo and confirm MELCHIOR turns green, pulses while it works and (with the hook) goes red on a permission prompt; start a second project and confirm BALTHASAR takes it; open MELCHIOR and confirm the board reflects this repo's specs, a ticked box updates live and subagent edits appear in the spec's timeline.
- Dogfood check: by feature 012, the visualizer should accurately show its own build history.
