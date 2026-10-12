# Contract: Command-Line Interface

```
agent-visualizer <repo-path> [--port <n>]
agent-visualizer --help | --version
```

| Argument | Required | Description |
|---|---|---|
| `<repo-path>` | yes (except `--help`/`--version`) | Directory to observe. Relative, `~`-prefixed and symlinked paths accepted. |
| `--port <n>` | no | Preferred port, integer 1-65535. Falls back to a free port if taken. |
| `--help` | no | Print usage to stdout, exit 0. |
| `--version` | no | Print the tool version to stdout, exit 0. |

## Output

On successful start, stdout receives (one line each):

```
Agent Visualizer <version>
Observing: <absolute repo path>
Listening: http://127.0.0.1:<actual port>
```

If a fallback occurred, a preceding line on stderr: `Port <requested> is in use; using <actual>.`

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean shutdown after SIGINT/SIGTERM, or `--help`/`--version` |
| 1 | Runtime/environment failure: repo path not found, not a directory, unreadable; config file unparseable or invalid; state dir not writable; instance already running for this repo |
| 2 | Usage error: missing `<repo-path>`, unknown flag, invalid `--port` |

Every non-zero exit prints a single message to stderr that names the specific problem and, for "already running", the existing address (`http://127.0.0.1:<port>`).

## Signals

`SIGINT` and `SIGTERM` stop the server, delete `server.json` and exit 0.
