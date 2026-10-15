# Data Model: Session Ingester

Types below are normative for names and fields; module locations are in [plan.md](./plan.md).

## TranscriptEntry (`src/agents/transcripts/entry.ts`)

The only thing kept from a JSONL line. Produced by `classifyLine(line)`; rules in [contracts/transcript-format.md](./contracts/transcript-format.md).

| Field | Type | Notes |
|-------|------|-------|
| `kind` | `"prompt" \| "tool-call" \| "tool-result" \| "progress" \| "final" \| "turn-end" \| "interrupt" \| "other"` | |
| `timestamp` | `string \| undefined` | ISO 8601 as written. Required for every kind except `other`. |
| `sessionId` | `string \| undefined` | |
| `cwd` | `string \| undefined` | |
| `model` | `string \| undefined` | Assistant entries only; never `<synthetic>`. |
| `toolUseIds` | `string[]` | `tool-call`: ids opened. `tool-result`: ids answered. Otherwise empty. |
| `completedAgentIds` | `string[]` | `prompt` from a task notification: subagent IDs reported done. Otherwise empty. |

`classifyLine` returns either `{ entry: TranscriptEntry }` or `{ issue: { reason: "invalid-json" | "not-an-object" | "missing-field", field?: string } }`. The caller adds file and byte position to make an `IngestIssue`.

## SessionState (`src/agents/transcripts/session-state.ts`)

Per-file reducer state. Pure: `applyEntry(state, entry) -> SessionState` returns a new object.

| Field | Type | Initial | Updated by |
|-------|------|---------|-----------|
| `sessionId` | `string \| undefined` | `undefined` | any entry with `sessionId` (latest wins) |
| `model` | `string \| undefined` | `undefined` | entry with `model` (latest wins) |
| `cwd` | `string \| undefined` | `undefined` | any entry with `cwd` (latest wins) |
| `state` | `"working" \| "standby"` | `"standby"` | see transitions |
| `stateSince` | `string \| undefined` | `undefined` | timestamp of the entry that last changed `state` |
| `lastActivity` | `string \| undefined` | `undefined` | max of entry timestamps |
| `openToolUseIds` | `string[]` | `[]` | add on `tool-call`, remove on `tool-result`, clear on `final`/`turn-end`/`interrupt` |
| `completedAgentIds` | `Record<string, string>` | `{}` | agent ID → timestamp of the notification entry that reported it done |
| `sawModel` | `boolean` | `false` | true once an entry with `model` is applied (tail-window check) |
| `sawStateEntry` | `boolean` | `false` | true once a state-bearing entry is applied (tail-window check) |

### State transitions

```text
                 prompt | tool-call | tool-result | progress
   ┌─────────┐ ─────────────────────────────────────────────▶ ┌─────────┐
   │ standby │                                                │ working │
   └─────────┘ ◀───────────────────────────────────────────── └─────────┘
                       final | turn-end | interrupt
   other: no change (both states)
```

Applying a working kind while already `working` (or a standby kind while `standby`) does not change `state` or `stateSince`.

The same reducer runs on each subagent file; `state` there is the subagent's own state.

## SubagentTrack (`src/agents/transcripts/source.ts`, internal)

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | `string` | from file name `agent-<agentId>.jsonl` |
| `tail` | `TailState` | |
| `state` | `SessionState` reducer state | |

**Running** (research R12): `state.state === "working"` and (`agentId` not in parent `completedAgentIds`, or subagent `lastActivity` > the notification timestamp).

## Combined session state

`turnState` = the session file's reducer `state`. `runningSubagents` = count of running subagents. Reported `state` = `"working"` if `turnState === "working"` or `runningSubagents > 0`, else `"standby"`. `stateSince` = timestamp of the entry (in the session or a subagent file) that caused the last change of the reported state. `lastActivity` = max over the session file and all its subagent files.

## AgentSession (`src/agents/source.ts`)

What any agent source exposes per session.

| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | `string` | latest `sessionId` in the file, else file stem |
| `source` | `string` | source name, `"transcripts"` here |
| `projectId` | `string` | git common dir, or cwd outside git |
| `projectName` | `string` | |
| `cwd` | `string \| undefined` | `undefined` until an entry with `cwd` is seen; such a session has `projectId` = `""` and is never main |
| `model` | `string \| undefined` | |
| `isMain` | `boolean` | `model !== undefined && mainAgentRegex.test(model)` |
| `state` | `SessionState` (`"working" \| "standby"`, from `src/contract/sessions.ts`) | combined state (see above); 005 extends with `"waiting"` |
| `runningSubagents` | `number` | |
| `stateSince` | `string \| undefined` | |
| `lastActivity` | `string \| undefined` | includes subagent activity |

A file contributes a session only once it has at least one timestamped entry.

## ProjectRef (`src/agents/transcripts/project.ts`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | absolute git common dir, or the cwd as recorded |
| `name` | `string` | parent folder of `.git`, bare repo name without `.git`, or basename of cwd |
| `inGit` | `boolean` | |

## AgentSourceEvent (`src/agents/source.ts`)

| Variant | Fields | Emitted when |
|---------|--------|--------------|
| `session-added` | `session: AgentSession` | a session is first reported (after its project is resolved) |
| `session-updated` | `session: AgentSession` | `model`, `isMain`, `cwd`, `projectId`, `projectName` or `runningSubagents` changed |
| `state-changed` | `sessionId`, `projectId`, `from`, `to`, `at` (causing entry's timestamp), `session` | `state` actually changed; exactly once per change |

Events for one file are emitted in entry order after that file's new lines are folded, but intermediate changes within one read are each emitted (a read that contains `prompt … final` emits `standby→working` then `working→standby`).

## IngestIssue (`src/agents/source.ts`)

| Field | Type |
|-------|------|
| `file` | `string` (absolute path) |
| `offset` | `number` (byte offset of the line start) |
| `reason` | `"invalid-json" \| "not-an-object" \| "missing-field" \| "unreadable"` |
| `detail` | `string \| undefined` |

The source keeps the most recent 200 issues (`issues()`), oldest dropped first.

## TailState (`src/agents/transcripts/tail.ts`)

| Field | Type | Notes |
|-------|------|-------|
| `path` | `string` | |
| `offset` | `number` | bytes consumed (including pending) |
| `pending` | `Uint8Array` | bytes after the last `\n` |
| `size` | `number` | at last read |
| `mtimeMs` | `number` | at last read |

`read()` returns `{ lines: { text: string; offset: number }[]; reset: boolean }`; `reset` is true when truncation was detected and the caller must rebuild the session from these lines.

## API view types (`src/contract/sessions.ts`)

See [contracts/sessions-api.md](./contracts/sessions-api.md): `SessionState`, `SessionView`, `ProjectView`, `SessionsResponse`.
