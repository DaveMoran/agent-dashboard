# Transcript fixtures

Scenarios here are copied by `tests/transcript-fixtures.ts` (`materializeTranscripts`) into a temp dir, with placeholders filled in. Never read `~/.claude` from tests.

## Placeholders

- `{{REPO}}`: main checkout of a temp git repo
- `{{WORKTREE}}`: a second worktree of that repo
- `{{PLAIN}}`: a temp dir outside git
- `{{MISSING}}`: a path that does not exist

A placeholder with no value makes `materializeTranscripts` throw.

## Line shapes

See `specs/004-session-ingester/contracts/transcript-format.md`. Lines are JSONL with `type` of `user`, `assistant`, `system` or other. User lines carry string or block `message.content` (`text`, `tool_result`); assistant lines carry `message.model`, `message.stop_reason` and `tool_use` blocks; `system` lines with `subtype: "turn_duration"` end a turn. Subagent lines add `isSidechain` and `agentId`.

## Content

All text was replaced with neutral strings; no real conversation content is kept.

## Scenarios

- `plain-turn`: one finished turn (meta, command, prompt, thinking, text, hook summary, turn end, snapshot); standby.
- `tool-calls`: two tool calls answered, a finished turn, then a new prompt with an unanswered tool call; working.
- `foreground-subagent`: parent waiting on an `Agent` call with one running subagent; working.
- `background-subagents`: three background agents, turn finished, a notification closes agent 2; agent 3 still running; turn standby, one running subagent.
- `interrupted`: partial assistant lines then a user interrupt; standby.
- `non-main`: two sessions in a plain dir on the sonnet model (one switched from opus); never main.
- `two-worktrees`: one session in the repo (working, last activity 10:05) and one in a worktree (standby, 10:02).
- `malformed`: invalid JSON, a non-object, an assistant line without timestamp, then a valid turn and a partial last line.
