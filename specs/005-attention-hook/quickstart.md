# Quickstart: validating the attention hook

## Prerequisites

- Bun ≥ 1.2 and git ≥ 2.31 on `PATH`; `bun install` done.

## 1. Automated checks

```sh
bun run verify
```

Expected: the new tests pass. In particular:

- `tests/hook-script.test.ts`: the script writes exactly the contract line, prints nothing, exits 0, and also exits 0 with a read-only state directory or invalid stdin.
- `tests/attention-combine.test.ts`: one case per acceptance scenario of spec US1 and US2, including per-agent scoping.
- `tests/attention-source.test.ts`: each scenario under `fixtures/attention/` gives identical final states in every read order (SC-002); no events file gives the same output as the transcript source alone (SC-005); fixture files are unchanged afterwards (SC-007).

## 2. Against fixtures through the real server

```sh
export AGENT_VISUALIZER_STATE_DIR="$(mktemp -d)" AGENT_VISUALIZER_TRANSCRIPTS_DIR="$(mktemp -d)"
bun run dev -- .
```

Copy a scenario's `projects/` into `$AGENT_VISUALIZER_TRANSCRIPTS_DIR` (with placeholders replaced, see `fixtures/transcripts/README.md`). Then pipe a sample `PermissionRequest` input into the hook:

```sh
echo '{"session_id":"<id>","cwd":"/tmp","hook_event_name":"PermissionRequest","tool_name":"Bash"}' | bun hooks/attention-hook.ts
curl -s http://127.0.0.1:<port>/api/sessions   # that session: "state": "waiting"
curl -s http://127.0.0.1:<port>/api/health     # attentionHook.seen: true
```

Then append a tool-result line to the session's transcript. Within 1 s, the session is `working` again.

## 3. Live dogfood (manual, the planner does this)

1. Run `bun run hook-settings`, then paste the output into `~/.claude/settings.json` yourself.
2. Start `bun run dev -- .`, then open a new Opus session in any repo, without auto mode.
3. Ask it to run a command that needs permission. While the prompt shows, that session is `waiting` in `/api/sessions`; after you answer it is `working`, then `standby` when the turn ends.
4. Ask it something that makes it use `AskUserQuestion`: `waiting` until you answer.
5. Let a background subagent hit a permission prompt while another subagent keeps working: the session stays `waiting` until you answer that prompt.
6. Wait over a minute after a turn ends: the session stays `standby` (the idle notification is not used).
7. Quit the session (`/exit`): it disappears from `/api/sessions`. Resume it and send a prompt: it comes back.
8. Remove the hook entries from your settings: nothing is ever `waiting`, and everything else behaves as in 004.

Confirm in `events.jsonl` that no line contains prompt text or tool input.
