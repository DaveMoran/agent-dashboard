# Agent Visualizer — Master Plan

## Context
Agent Visualizer is a small local web UI, styled after the MAGI from Neon Genesis Evangelion, that shows up to three Claude Code projects at once. Each project gets one of three "brains": MELCHIOR•1, BALTHASAR•2 and CASPER•3. A brain shows whether its project's agent is not active, on standby, working or waiting for the user. V1 is only that display. Later, clicking a brain opens the project: its sessions and subagents, its spec pipeline and a per-spec history.

The working setup it is built around: a main agent (Claude Opus or Fable) per project, which hands implementation to Claude Sonnet subagents. Projects use a spec-driven framework, so the tool stays **SDD-framework agnostic** (plain markdown, Spec Kit, OpenSpec, BMAD).

V1 only *observes* Claude Code. Controlling agents (talking to a brain, answering its prompts) comes later through the Claude Agent SDK, together with a hardware controller: a microphone with three buttons, one per brain.

The tool is **dogfooded**: built with Spec Kit, so its own repo is the first live fixture.

## Decisions
| Area | Decision |
|---|---|
| Role | Observe only in V1 (no orchestration). Control comes with the Agent SDK pivot (see Later) and needs a constitution amendment |
| Scope | Up to three projects at once, one per brain. Projects are found from active Claude Code sessions; no repo path is needed. A fourth active project is not shown |
| V1 scope | Only the three brains and their state (specs 004–008). Click-through, subagent details, spec board, graph, timeline and further adapters come later |
| Brains | MELCHIOR (1), BALTHASAR (2), CASPER (3). A project takes the lowest free brain when its first main-agent session becomes active and keeps it while active; it is freed once all its main sessions have ended or timed out. A `working` or `standby` main session with no activity for 30 min stops counting for its brain, a `waiting` one after 4 h (`idleTimeoutMinutes`, `waitingTimeoutMinutes`); a crashed session stops counting after its timeout. No reshuffling |
| Project | The git common dir of a session's `cwd` (all worktrees of a repo are one project), or the `cwd` itself outside git |
| Main agent | A session whose model matches a configurable regex (default `^claude-(opus|fable)`). Only main agents light up a brain; subagents and other sessions show inside their project |
| Brain states | not active (no project): black, red lettering; standby (agent idle): green; working: slow green↔blue pulse (≥ 2 s per cycle, steady under reduced motion); waiting for the user: red. Always shown as text too. Combined over the project's main sessions: waiting > working > standby. A running subagent, background ones included, keeps its main session working |
| Waiting detection | Transcripts give working/standby: a turn ends at an `end_turn` reply, a `turn_duration` line or an interrupt line. "Waiting" needs the opt-in attention hook, which the user installs in their own Claude Code settings and which writes only to the visualizer's state directory. Without it nothing is red |
| Agent sources | Session state comes through an "agent source" interface: transcripts (004), attention hook (005), later the Agent SDK |
| Platform | Desktop only, minimum width 1024px |
| Repo layout | One repo for now: the UI (`src/web/`) and the local MAGI server. The UI reaches the server only over HTTP/SSE and imports only the shared contract module `src/contract/` (constitution, Technology Constraints). They move to separate repos later (see Later) |
| Stack | TypeScript, Bun server, React + Vite UI, React Flow for DAG, SSE for live updates |
| Views | V1: MAGI panel only. Later: MAGI panel → project view (sessions + spec board/graph) → per-spec timeline |
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
| State directory | `~/.agent-visualizer/` (override with `AGENT_VISUALIZER_STATE_DIR`); never inside an observed repo. Per-repo instances use `instances/<repo-key>/server.json`; the no-path MAGI instance uses `magi/server.json` |
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
- `Event { ts, sessionId?, agent: main|subagent|human|git, model?, specId?, kind: spec-created|status-change|task-checked|file-edit|bash|test-run|commit|prompt, detail }` (replaces the planner/coder `role` when the project view is built)

**Adapter contract:** `detect(repo) → bool`, `discover(repo) → paths/globs to watch`, `parse(files) → Spec[]` (details in [`adapters.md`](adapters.md)). Status derivation per framework:
- *Spec Kit:* `specs/NNN-feature/` — spec.md only → drafted; +plan.md → planned; +tasks.md → ready; some boxes checked → in-progress; all checked → review; fully ticked tasks.md on main → done (covers merge, squash and deleted branches). Feature branch `NNN-feature` gives attribution for free.
- *Plain markdown:* `specs/NNN-slug.md` frontmatter `status`, `depends_on`.
- *OpenSpec:* `openspec/changes/<id>/` (proposal.md, tasks.md); moved to archive → done.
- *BMAD:* story files' `Status:` field (+ sprint status file if present); epics → grouping.

**Transcript source:** polls every 500 ms (no file watching) and tails every session JSONL under `~/.claude/projects/`, including subagent transcripts; a subagent counts as running until it ends its turn or the main session records its task notification, and one that dies with neither stays running until 006's idle timeout (brain level); queued notification lines close subagents too, and a `continued-in` line ends a session; groups sessions into projects; records prompts, tool calls (Edit/Write → file-edit, Bash → bash/test-run), model, `cwd`, `gitBranch`, timestamps.

**Attention hook source (005):** reads `<state-root>/hooks/events.jsonl`, written by the opt-in script `hooks/attention-hook.ts` (Bun, imports only `node:` modules, one atomic append per event, silent, always exit 0, stores no prompt or tool input). Event mapping:

| Hook event | Matcher | Meaning | Belongs to |
|---|---|---|---|
| `PermissionRequest` | all | wait starts | `agent_id` if present, else main |
| `PreToolUse` | `AskUserQuestion\|ExitPlanMode` | wait starts | `agent_id` or main |
| `Elicitation` | all | wait starts | `agent_id` or main |
| `PostToolUse`, `PostToolUseFailure` | `AskUserQuestion\|ExitPlanMode` | wait ends | `agent_id` or main |
| `ElicitationResult` | all | wait ends | `agent_id` or main |
| `UserPromptSubmit`, `Stop`, `StopFailure` | none | wait ends | main |
| `SubagentStop` | none | wait ends | that subagent |
| `SessionEnd` | none | session ends | session |

Idle notifications are not subscribed and never count as waiting.

*Per-agent rule (FR-008):* a wait belongs to the agent that raised it (main or one subagent). A main session is `waiting` while any of its agents has a wait later than every end signal for that same agent. End signals for an agent are a later turn entry in its own transcript (bookkeeping entries do not count), its hook "done" events, and for a subagent its completion notice in the main transcript. One agent's signals never end another's wait. Combined order of read passes does not change the result.

*Sync/async split (R3):* wait-start hooks and `SessionEnd` are synchronous so their timestamp precedes the answer that ends the wait (and Claude Code may exit before a background hook runs); wait-end hooks are `"async": true` and add no turn latency.

*Session end:* `SessionEnd` removes the session from the listing; later activity revives it. `bun run hook-settings` prints the settings snippet, and the visualizer never edits Claude Code settings. `/api/health` reports `attentionHook: { seen, lastEventAt }`.

**Brain `stateSince` (006):** a brain's `stateSince` changes only when its state or project changes. When it is freed it is the time the project stopped being active (a timed-out session drops at `lastActivity + timeout`, an ended one at the time it was noticed). When a brain takes a project it is the latest session `stateSince` in the new state, raised to now (except on the first step after start, which keeps the sessions' own history). A brain free since start has `null`. See `specs/006-magi-slots/research.md` R5.

**Attribution order:** git branch on transcript entry → spec ID mentioned in prompt/commit → edited files ∈ spec's artifact/likely-files → time window between status transitions.

## Views
- **MAGI panel (V1, only screen):** three brains with their state, project name and state text. Display only.
- **Project view (later):** the project's main sessions and subagents with state and a live feed; spec board with status columns, task progress ("6/9"), blocked/ready highlighting and a pulse on recently touched specs; toggle to **dependency graph** (React Flow).
- **Per-spec timeline (later):** swimlanes for main agent, each subagent type and git; spec authored/revised, status changes, task checks, file edits, test runs (pass/fail if detectable), commits; click event → detail drawer.

## Feature specs (Spec Kit features, in build order)
1. **001-server-skeleton** — Bun server, CLI arg for repo path, config file, health endpoint, Vite React shell. *(shipped)*
2. **002-common-model-adapter-interface** — types, adapter registry, auto-detect, file watcher with debounce. *(shipped)*
3. **003-speckit-adapter** — status derivation above, worktrees, merged rule. *(shipped)*
4. **004-session-ingester** — all projects' JSONL, sessions → projects, main-agent rule, working/standby, agent-source interface.
5. **005-attention-hook** — opt-in hook script and hook source for the waiting state.
6. **006-magi-slots** — brain assignment and lifecycle, no repo path needed.
7. **007-live-updates** — SSE stream of brain states, client store.
8. **008-magi-panel** — the three brains. **End of V1.**

After V1 (numbered when picked up): project view, git ingester and attribution, dependency graph, spec timeline, plain-markdown, OpenSpec and BMAD adapters.

Seeds for each are in [`feature-seeds.md`](feature-seeds.md).

## Later (not v1)
- The spec and history views listed after V1 above.
- **Agent SDK mode** (planned for when the hardware is ready): the visualizer hosts brains through the Claude Agent SDK, so "waiting" is exact and the user can talk to a brain and answer its prompts from the UI. The transcript and hook sources stay for Claude Code sessions. Needs a constitution amendment (control features, and network calls to the Anthropic API). Check SDK authentication and billing first.
- **Brain API:** local endpoints to send a message to a brain, read what it is waiting on and get a short summary; the hardware is a client of it.
- **Hardware controller:** a microphone with three buttons, one per brain. Press a button and speak to send that brain a message; tap a red brain to hear what it is waiting on.
- Metrics (time and tokens per spec, stall and loop detection).
- **Split the UI from the MAGI server** into two repos once the UI is solid: after the brain drill-down views (project view, sessions and subagents) have settled through a few versions. Split earlier if a second backend (the incident service) or a non-browser client (the hardware) arrives first. The UI keeps talking to the server over HTTP/SSE; `src/contract/` becomes a published, versioned schema that the UI pins and tests against. Separate repos also suit MAGI itself, since each repo is its own project on its own brain.
- **Incident takeover:** a separate repo and service that receives production alerts (webhooks from monitoring) and decides when to page. When an incident opens, the UI shows a full-screen takeover styled after Evangelion's power timer: a countdown to when it becomes a real problem (ideally time until the error budget runs out at the current burn rate, not a fixed five minutes), STOP/SLOW/NORMAL/RACING as burn rate or severity, INTERNAL/EXTERNAL as the alert's source. It is network-facing, so it lives outside this repo's local-only, read-only rules; the UI's connection to it needs a constitution amendment. With SDK brains, an incident could be handed to a brain from the takeover screen. Starts only once there is an application in production with alerting.

## Verification
- Unit: each adapter tested against a fixture repo under `fixtures/<framework>/` (`bun test`); transcript and hook sources against recorded samples in `fixtures/`.
- End-to-end: start `agent-visualizer`, start an Opus session in this repo and confirm MELCHIOR turns green, pulses while it works and (with the hook) goes red on a permission prompt; start a session in a second project and confirm BALTHASAR takes it; end both and confirm the brains return to not active after the timeout.
- Dogfood check: once 008 lands, MELCHIOR should show this repo's own session going between standby, working and waiting.
