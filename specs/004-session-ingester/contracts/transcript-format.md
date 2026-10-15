# Contract: Transcript line classification

`classifyLine(line: string)` in `src/agents/transcripts/entry.ts`. Pure, no I/O. Rules apply top to bottom; the first match wins.

## Parsing

1. `JSON.parse(line)` throws → issue `invalid-json`.
2. Result is not a plain object (array, null, number, string) → issue `not-an-object`.
3. `type` is not a string → issue `missing-field`, field `type`.

Common fields copied onto every entry when they are strings: `timestamp`, `sessionId`, `cwd`. Nothing else is copied.

## `type: "user"`

4. `timestamp` missing → issue `missing-field`, field `timestamp`.
5. `isMeta === true` → `other`.
6. `message.content` is an array containing at least one block with `type: "tool_result"` → `tool-result`, `toolUseIds` = those blocks' `tool_use_id` strings.
7. Let `text` be `message.content` if it is a string, else the `text` of the first block with `type: "text"`, else `""`.
   - `text` starts with `[Request interrupted by user` → `interrupt`.
   - `text` starts with `<task-notification>` → `prompt`, and `completedAgentIds` = the contents of every `<task-id>…</task-id>` in `text` that is followed (anywhere in `text`) by a `<status>…</status>` element. (A notification starts a new turn of the main agent, and tells us the named subagents are done.)
   - `text` starts with any of `<command-name>`, `<local-command-`, `<bash-input>`, `<bash-stdout>`, `<bash-stderr>` → `other`.
8. `message.content` is a non-empty string, or an array with at least one `text` or `image` block → `prompt`.
9. Otherwise → `other`.

## `type: "assistant"`

10. `timestamp` missing → issue `missing-field`, field `timestamp`.
11. `model` = `message.model` if it is a non-empty string and not `<synthetic>`.
12. `message.content` contains at least one block with `type: "tool_use"` → `tool-call`, `toolUseIds` = those blocks' `id` strings.
13. `message.stop_reason` is `null`, missing, or `"tool_use"` → `progress`.
14. Otherwise (any other non-null `stop_reason`, e.g. `end_turn`, `stop_sequence`, `max_tokens`, `refusal`) → `final`.

## `type: "system"`

15. `subtype === "turn_duration"` and `timestamp` present → `turn-end`.
16. Otherwise → `other`.

## `type: "attachment"`

17a. `attachment.type === "queued_command"` and `attachment.prompt` is a string starting with `<task-notification>` → `other`, with `completedAgentIds` extracted from `attachment.prompt` exactly as in rule 7. (A notice queued while the main agent is busy; it does not start a turn.)
17b. Otherwise → `other`.

## `type: "continued-in"`

17c. `timestamp` present → `session-end` (the conversation continued in another session file; this session is over).

## Any other `type`

17. → `other` (unknown types are expected and harmless; no issue).

## Examples (trimmed shapes, as used in fixtures)

```jsonl
{"type":"user","timestamp":"2026-10-15T10:00:00.000Z","sessionId":"s1","cwd":"{{REPO}}","message":{"role":"user","content":"Add a test"}}
{"type":"assistant","timestamp":"2026-10-15T10:00:02.000Z","sessionId":"s1","cwd":"{{REPO}}","message":{"id":"m1","model":"claude-opus-5-5","stop_reason":"tool_use","content":[{"type":"thinking","thinking":""}]}}
{"type":"assistant","timestamp":"2026-10-15T10:00:02.100Z","sessionId":"s1","cwd":"{{REPO}}","message":{"id":"m1","model":"claude-opus-5-5","stop_reason":"tool_use","content":[{"type":"tool_use","id":"tu1","name":"Agent","input":{}}]}}
{"type":"user","timestamp":"2026-10-15T10:03:00.000Z","sessionId":"s1","cwd":"{{REPO}}","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu1","content":"done"}]}}
{"type":"assistant","timestamp":"2026-10-15T10:03:05.000Z","sessionId":"s1","cwd":"{{REPO}}","message":{"id":"m2","model":"claude-opus-5-5","stop_reason":"end_turn","content":[{"type":"text","text":"Done."}]}}
{"type":"system","subtype":"turn_duration","timestamp":"2026-10-15T10:03:05.100Z","sessionId":"s1","cwd":"{{REPO}}"}
{"type":"user","timestamp":"2026-10-15T10:05:00.000Z","sessionId":"s1","cwd":"{{REPO}}","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]}}
{"type":"user","timestamp":"2026-10-15T10:06:00.000Z","sessionId":"s1","cwd":"{{REPO}}","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>…"}}
{"type":"user","timestamp":"2026-10-15T10:06:00.100Z","sessionId":"s1","cwd":"{{REPO}}","message":{"role":"user","content":"<command-name>/model</command-name>"}}
{"type":"file-history-snapshot","timestamp":"2026-10-15T10:06:01.000Z"}
{"type":"user","timestamp":"2026-10-15T10:07:00.000Z","sessionId":"s1","cwd":"{{REPO}}","message":{"role":"user","content":"<task-notification>\n<task-id>a0b1c2d3e4f5a6b7c</task-id>\n<tool-use-id>tu9</tool-use-id>\n<status>completed</status>\n</task-notification>"}}
```

Expected kinds, in order: `prompt`, `progress`, `tool-call` (`tu1`), `tool-result` (`tu1`), `final`, `turn-end`, `interrupt`, `other`, `other`, `other`, `prompt` (`completedAgentIds: ["a0b1c2d3e4f5a6b7c"]`).

Two more shapes, seen in Claude Code 2.1.300 (added after the live check of T021):

```jsonl
{"type":"attachment","timestamp":"2026-10-15T10:08:00.000Z","sessionId":"s1","cwd":"{{REPO}}","attachment":{"type":"queued_command","commandMode":"task-notification","prompt":"<task-notification>\n<task-id>a1111111111111111</task-id>\n<status>completed</status>\n</task-notification>"}}
{"type":"continued-in","timestamp":"2026-10-15T10:09:00.000Z","sessionId":"s1","continuedInSessionId":"s2"}
```

Expected: `other` (`completedAgentIds: ["a1111111111111111"]`), `session-end`.

Subagent transcript lines use the same shapes (plus `"isSidechain":true`, `"agentId"`) and are classified by the same function.
