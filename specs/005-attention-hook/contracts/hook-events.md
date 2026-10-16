# Contract: Attention hook and its events file

The hook script `hooks/attention-hook.ts` writes this file and the attention source (`src/agents/attention/`) reads it. Research: [R1–R3](../research.md).

## File

`<state-root>/hooks/events.jsonl`, where `<state-root>` is `$AGENT_VISUALIZER_STATE_DIR`, or else `~/.agent-visualizer` (same as `stateRoot()` in `src/server/state.ts`). The hook creates the directory (mode `0700`) and the file. The visualizer only reads them. The file is not rotated, and the user may delete it at any time.

## Line format

One JSON object per line, terminated by `\n`, written with a single append:

```json
{"ts":"2026-10-15T10:00:00.123Z","session":"0c303220-f66d-480c-8db7-9afc189a2260","cwd":"/Users/me/repo","event":"PermissionRequest","type":"Bash","agent":"aabcc9e032d23a66b"}
```

| Field | Required | Source in hook input | Notes |
|---|---|---|---|
| `ts` | yes | the time the script ran, `new Date().toISOString()` | |
| `session` | yes | `session_id` | |
| `cwd` | no | `cwd` | omitted if absent |
| `event` | yes | `hook_event_name` | |
| `type` | no | first present of `notification_type`, `tool_name`, `reason` | omitted if none is present |
| `agent` | no | `agent_id` | present only inside a subagent |

No other field is ever written. If the input is not a JSON object, or lacks `session_id` or `hook_event_name`, the script writes nothing.

## Script behaviour (all inputs)

- Reads all of stdin, then writes at most one line.
- Writes nothing to stdout or stderr. Exits with code 0, including on any error (unparseable input, unwritable directory).
- Imports only `node:fs`, `node:os`, `node:path`.

## Reader classification

`classifyHookLine(text) -> { event: HookEvent } | { issue }` (pure):

- not JSON → issue `invalid-json`; not an object → `not-an-object`; `ts`, `session` or `event` missing, not a string, or `ts` not a parseable date → `missing-field` with that field's name.
- otherwise `HookEvent { ts, sessionId, cwd?, event, type?, agentId? }` with `meaning` from the table below.

| `event` | `type` condition | `meaning` | `agentKey` |
|---|---|---|---|
| `PermissionRequest` | any | `wait-start` | `agent` or `""` |
| `PreToolUse` | `AskUserQuestion` or `ExitPlanMode` | `wait-start` | `agent` or `""` |
| `Elicitation` | any | `wait-start` | `agent` or `""` |
| `PostToolUse`, `PostToolUseFailure` | `AskUserQuestion` or `ExitPlanMode` | `wait-end` | `agent` or `""` |
| `ElicitationResult` | any | `wait-end` | `agent` or `""` |
| `UserPromptSubmit`, `Stop`, `StopFailure` | any | `wait-end` | `""` |
| `SubagentStop` | any | `wait-end` | `agent` (ignored if absent) |
| `SessionEnd` | any | `session-end` | — |
| anything else (including `PreToolUse` for other tools) | | `ignored` | — |

## Settings snippet (documentation and `bun run hook-settings`)

The user adds this to `~/.claude/settings.json`, merging with any `hooks` they already have. `<BUN>` and `<REPO>` are absolute paths, and `bun run hook-settings` prints the snippet with them filled in. The visualizer never writes this file.

```json
{
  "hooks": {
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts" }] }],
    "PreToolUse": [{ "matcher": "AskUserQuestion|ExitPlanMode", "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts" }] }],
    "Elicitation": [{ "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts" }] }],
    "PostToolUse": [{ "matcher": "AskUserQuestion|ExitPlanMode", "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts", "async": true }] }],
    "PostToolUseFailure": [{ "matcher": "AskUserQuestion|ExitPlanMode", "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts", "async": true }] }],
    "ElicitationResult": [{ "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts", "async": true }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts", "async": true }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts", "async": true }] }],
    "StopFailure": [{ "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts", "async": true }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts", "async": true }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "<BUN> <REPO>/hooks/attention-hook.ts" }] }]
  }
}
```

Wait-start hooks and `SessionEnd` are synchronous on purpose (research R3). Every event key in the snippet appears in the mapping table, and vice versa (a test checks this).
