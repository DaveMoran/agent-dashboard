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
