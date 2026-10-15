# Implementation Plan: Session Ingester

**Branch**: `004-session-ingester` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-session-ingester/spec.md`

## Summary

Read every top-level Claude Code session transcript under `~/.claude/projects/*/`, incrementally and read-only, and keep an in-memory picture of each session: its model, working directory, project (git common dir), whether it is a main agent, its state (`working` or `standby`) and its last activity. The picture sits behind an `AgentSource` interface (sessions, events, start/stop) so later sources (attention hook in 005, Agent SDK later) plug in without touching consumers. `GET /api/sessions` serves projects with their main sessions, shaped by types in a new `src/contract/` module.

The technical approach (see [research.md](./research.md)): classify each JSONL line into a small entry kind with a pure function; fold entries into session state with a pure reducer whose rule is "the last state-bearing entry decides"; tail files by byte offset with a byte-level partial-line buffer; discover and re-read files by polling (stat-only when nothing changed) rather than recursive `fs.watch`; read only the tail window of large files on first start when that provably gives the same state; resolve projects with one cached `git rev-parse --git-common-dir` per working directory.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Bun ≥ 1.2 (local: 1.4.3)

**Primary Dependencies**: none new. Bun built-ins (`Bun.file`, `Bun.serve`, `Bun.spawn`), `node:fs`/`node:path`; existing `src/git/run.ts` for read-only git.

**Storage**: in memory only. No files written (not even in the state directory) by this feature.

**Testing**: `bun test`; fixtures under `fixtures/transcripts/`, copied into temp dirs with placeholders substituted (working dirs must point at real temp git repos for project grouping).

**Target Platform**: macOS and Linux desktop, local only.

**Project Type**: local web app (Bun server + Vite/React UI); this feature is server-only plus a contract module.

**Performance Goals**: state change visible in `/api/sessions` within 1 s (SC-002); first read of 200 files / 500 MB within 10 s (SC-003); steady-state poll costs a directory listing per project folder plus one `stat` per known file.

**Constraints**: read-only on `~/.claude/projects` and every observed repo (Principle III); no network; UI may only import `src/contract/`; no new dependencies.

**Scale/Scope**: tens of project folders, hundreds of session files, single files up to tens of MB with individual lines up to several MB (`api-request-blob`, large tool results).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan complies |
|-----------|--------|------------------------|
| I. Feature branches and PRs only | Pass | Work on `004-session-ingester`; ends in a PR. |
| II. Documentation ships with the code | Pass | Docs task updates `README.md` (config keys, env var, `/api/sessions`, transcripts read-only note, project structure) and `docs/master-spec.md` (turn-end detection, polling, background-subagent limitation). |
| III. Read-only observer | Pass | Transcripts are only `stat`ed and read; git calls are `rev-parse` with `GIT_OPTIONAL_LOCKS=0` (existing `runGit`). A test asserts fixture bytes and mtimes are unchanged after a run (SC-006). |
| IV. Framework-agnostic through adapters | Pass | Not touched: this feature has no spec-framework knowledge. Claude Code transcript knowledge is confined to `src/agents/transcripts/`, behind `AgentSource`. |
| V. Test-backed and fixture-driven | Pass | Pure classifier and reducer get table tests; tailer, discovery and source get fixture tests in temp dirs; endpoint gets a stub-source test and an e2e test. No test reads the live `~/.claude`. |
| VI. Small, explicit tasks | Pass | Each module is small and named in the structure below; contracts spell out exact classification rules so tasks are mechanical. No new dependency. |
| VII. Commit at every workflow step | Pass | Spec committed before this step; plan artifacts committed at the end of this step. |
| VIII. Logical, incremental commits | Pass | Tasks map to one module each, committed with their tests. |
| Tech: UI/server boundary | Pass | Response types live in `src/contract/sessions.ts`; server imports them, UI may. Contract imports nothing from server code. |
| Tech: local-only | Pass | No network. |

No violations. Complexity Tracking is empty.

**Post-design re-check (after Phase 1)**: still passes. The design adds one directory (`src/agents/`) and one contract file; the tail-window optimisation is a single function with an equivalence test, justified by SC-003.

## Project Structure

### Documentation (this feature)

```text
specs/004-session-ingester/
├── plan.md                         # This file
├── research.md                     # Phase 0: decisions on format, state rule, tailing, polling, projects
├── data-model.md                   # Phase 1: entities, fields, state transitions
├── quickstart.md                   # Phase 1: how to validate end to end
├── contracts/
│   ├── transcript-format.md        # What we read from a JSONL line and how each line is classified
│   ├── agent-source.md             # The AgentSource interface and its event semantics
│   └── sessions-api.md             # GET /api/sessions request/response
├── checklists/requirements.md
└── tasks.md                        # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── contract/
│   └── sessions.ts                 # NEW: SessionState, SessionsResponse, ProjectView, SessionView (no imports from server)
├── agents/
│   ├── source.ts                   # NEW: AgentSource interface, AgentSession, AgentSourceEvent, IngestIssue
│   ├── main-agent.ts               # NEW: DEFAULT_MAIN_AGENT_PATTERN, compileMainAgentPattern() -> { regex, warning? }
│   └── transcripts/
│       ├── entry.ts                # NEW: classifyLine(line) -> TranscriptEntry | IngestIssue (pure)
│       ├── session-state.ts        # NEW: initialSessionState(), applyEntry(state, entry) (pure reducer)
│       ├── tail.ts                 # NEW: FileTail: byte offset, partial-line bytes, truncation reset, tail-window first read
│       ├── discover.ts             # NEW: listSessionFiles(root) -> top-level <folder>/<name>.jsonl paths
│       ├── project.ts              # NEW: createProjectResolver(runGit) -> resolve(cwd): Promise<ProjectRef>, cached
│       └── source.ts               # NEW: createTranscriptSource(options): AgentSource (polling loop, events, dedupe)
├── server/
│   ├── config.ts                   # CHANGED: optional "mainAgentModel" and "transcriptsDir" string settings
│   ├── sessions.ts                 # NEW: buildSessionsResponse(sessions, isMain) -> SessionsResponse (pure)
│   ├── routes.ts                   # CHANGED: GET /api/sessions using HandlerOptions.agentSource
│   └── start.ts                    # CHANGED: StartOptions.agentSource passed to the handler
└── cli/index.ts                    # CHANGED: build pattern + transcripts root, start/stop the transcript source, print pattern warning

fixtures/transcripts/
├── <scenario>/                     # one folder per scenario, laid out like ~/.claude/projects/
│   └── <project-folder>/<session-uuid>.jsonl   (+ <session-uuid>/subagents/agent-*.jsonl where relevant)
└── README.md                       # placeholder list ({{REPO}}, {{WORKTREE}}, {{PLAIN}}) and how fixtures were trimmed

tests/
├── transcript-entry.test.ts        # NEW: classification table tests
├── session-state.test.ts           # NEW: reducer tests, one per acceptance scenario of US1
├── transcript-tail.test.ts         # NEW: offsets, partial lines (incl. split UTF-8), truncation, tail window equivalence
├── transcript-discover.test.ts     # NEW: top-level only, subagents ignored, missing root
├── transcript-project.test.ts      # NEW: worktrees -> one project, subfolder, non-git, missing dir, cache
├── main-agent.test.ts              # NEW: default/custom/invalid pattern
├── transcript-source.test.ts       # NEW: fixture scenarios end to end through the source, events exactly once, dedupe, read-only check
├── sessions-api.test.ts            # NEW: buildSessionsResponse + route with a stub source
├── stub-agent-source.ts            # NEW: scripted AgentSource for consumer tests
├── transcript-fixtures.ts          # NEW: materialise a fixture scenario into a temp root with placeholders replaced
├── config.test.ts                  # CHANGED: new settings
└── cli.e2e.test.ts                 # CHANGED: /api/sessions served from AGENT_VISUALIZER_TRANSCRIPTS_DIR
```

**Structure Decision**: single project, as in 001–003. A new `src/agents/` holds the agent-source interface (generic) and `src/agents/transcripts/` the Claude Code transcript source (format-specific). `src/contract/` is created here as the shared server/UI type module named in the constitution. The `/api/sessions` mapping is a pure function in `src/server/sessions.ts` so it is testable without HTTP.

## Complexity Tracking

No constitution violations.
