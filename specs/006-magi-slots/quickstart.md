# Quickstart: MAGI Slots

How to check, by hand and with tests, that 006 works. The contracts are in [contracts/](./contracts/) and the rules are in [data-model.md](./data-model.md) and [research.md](./research.md).

## Automated

```sh
bun run verify
```

The tests that cover this spec:
- `tests/magi-slots.test.ts`: pure `stepSlots` scenarios with a fake clock (FR-018).
- `tests/magi-service.test.ts`: the service with the stub agent source and a fake clock. It covers ticking and freeing with no new events.
- `tests/magi-fixtures.test.ts`: the real transcript source on `fixtures/transcripts/` scenarios, with `now` pinned near the fixture times.
- `tests/config.test.ts`, `tests/args.test.ts`, `tests/state.test.ts`, `tests/server.test.ts`: the timeout keys, the optional path, the path-less record and `/api/magi` + health.
- `tests/cli.e2e.test.ts`: a path-less start, a second-instance refusal and cleanup of the record.

## Manual (live)

Use a scratch state directory so your real one is untouched:

```sh
export AGENT_VISUALIZER_STATE_DIR="$(mktemp -d)"
bun run src/cli/index.ts            # no path
```

Expected output: `Observing: all Claude Code projects` and a `Listening:` URL. `$AGENT_VISUALIZER_STATE_DIR/magi/server.json` exists with `"repoPath": null`.

1. `curl -s localhost:4317/api/magi | jq`: three brains. If you have an Opus/Fable session active in this repo in the last 30 min, MELCHIOR holds `agent-visualizer`, with its path the repo root.
2. In a second terminal, start a Claude Code Opus session in another repo and send a prompt. Within about 1 s, BALTHASAR holds that project and shows `working`, then `standby` when the turn ends.
3. With the attention hook installed (005), trigger a permission prompt: that brain shows `waiting`.
4. Start a second instance with no path: it exits 1 with `Agent Visualizer is already running at http://127.0.0.1:<port>`.
5. Put `{ "idleTimeoutMinutes": 0.5 }` in `./agent-visualizer.config.json`, restart, end your turn and wait 30 s or more: the brain goes to `not-active` within a few seconds after that, with `project: null`.
6. Put `{ "idleTimeoutMinutes": 0 }`: startup fails with exit 1 and `"idleTimeoutMinutes" must be a positive number of minutes`.
7. `curl -s localhost:4317/api/health`: `"repoPath": null, "repoName": null`.
8. Ctrl-C: `magi/server.json` is removed.

Clean up the config file from step 5 afterwards.

## Dogfood check

While this spec is implemented, MELCHIOR should show this repo's own Opus session going between `working` and `standby`. The dead session `db3f06ca` (see the 004/005 follow-up) must not keep any brain `working`.
