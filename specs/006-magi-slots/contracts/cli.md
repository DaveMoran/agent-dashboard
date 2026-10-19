# Contract: CLI, config and instance record

## Usage

```
Usage: agent-visualizer [<repo-path>] [--port <n>]
       agent-visualizer --help | --version

Arguments:
  <repo-path>    Optional. Directory to observe for config lookup and the per-repo
                 instance record. Brains always show every active project.
  --port <n>     Preferred port, integer 1-65535. Falls back to a free port if taken.
```

Exit codes:
- `0`: clean shutdown, `--help`, `--version`.
- `1`: runtime failure. Covers everything from 001: bad repo path, invalid config (now including the timeout keys), state dir not writable, and an instance already running (for that repo, or the path-less instance).
- `2`: usage error. Unknown flag, invalid `--port`, more than one positional. A missing path is **no longer** an error.

## Startup output

With a path, the output is unchanged: `Observing: <repo-path>`. Without a path, it prints `Observing: all Claude Code projects`. The `Agent Visualizer <version>`, `Transcripts:` and `Listening:` lines are printed in both cases.

## "Already running" messages

- With a path, unchanged: `Agent Visualizer is already running for <repo-path> at http://127.0.0.1:<port>`
- Without a path: `Agent Visualizer is already running at http://127.0.0.1:<port>`

## Instance record

| Started with | Location |
|---|---|
| a repo path | `<state-root>/instances/<repo-key>/server.json` (unchanged) |
| no path | `<state-root>/magi/server.json` |

`<state-root>` = `$AGENT_VISUALIZER_STATE_DIR` or `~/.agent-visualizer`. Content is `{ "port", "pid", "repoPath", "startedAt", "version" }`, with `repoPath: null` for the path-less record. It is written atomically at startup and removed on clean shutdown only if the `pid` matches. A record whose process is dead, or whose `/api/health` does not answer with the same `repoPath`, does not block a start.

## Config file (`agent-visualizer.config.json`)

Lookup: `<repo-path>` then the current directory when a path is given; only the current directory when not. The first file found wins.

New optional keys:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `idleTimeoutMinutes` | number > 0 | `30` | A `working` or `standby` main session with no activity for this long stops counting for its brain |
| `waitingTimeoutMinutes` | number > 0 | `240` | The same for a `waiting` session |

An invalid value (non-number, ≤ 0, `NaN`/infinite) → exit 1 with:
`Invalid config in <file>: "<key>" must be a positive number of minutes, got <JSON value>`
