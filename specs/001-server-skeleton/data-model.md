# Data Model: Server Skeleton

All types live in `src/server/` and are defined in TypeScript; none are persisted other than `InstanceRecord`.

## CliOptions
Result of argument parsing (`args.ts`).

| Field | Type | Rules |
|---|---|---|
| `repoPath` | string | Required positional; raw user input before resolution |
| `port` | number \| undefined | Integer 1-65535 when present; undefined if flag not given |
| `help` | boolean | `--help` |
| `version` | boolean | `--version` |

Validation: unknown flags, missing `repoPath` (unless help/version), non-integer or out-of-range `--port` produce a `UsageError` with a message and the usage text; the CLI prints it to stderr and exits 2.

## RepoTarget
Result of `resolveRepoPath()` (`repo.ts`).

| Field | Type | Rules |
|---|---|---|
| `path` | string | Absolute real path (symlinks resolved, `~` expanded, no trailing slash) |
| `name` | string | Basename of `path`; shown on the placeholder page |

Errors: `RepoNotFound`, `RepoNotDirectory`, `RepoNotReadable`, each carrying the offending path.

## Config
Result of `loadConfig()` (`config.ts`).

| Field | Type | Rules |
|---|---|---|
| `port` | number \| undefined | Integer 1-65535 if present |
| `source` | string \| undefined | Absolute path of the file used, for error messages and logging |

Resolution order: file in `RepoTarget.path`, else file in `process.cwd()`, else none. Unknown keys ignored. Errors: `ConfigParseError` (invalid JSON), `ConfigValueError` (e.g. non-integer port), both naming `source`.

## EffectiveSettings
Merged result: `port = cli.port ?? config.port ?? DEFAULT_PORT (4317)`.

## InstanceRecord (persisted as `server.json`)

| Field | Type | Rules |
|---|---|---|
| `port` | number | The port actually bound (after any fallback) |
| `pid` | number | Process ID of the server |
| `repoPath` | string | Same absolute real path as `RepoTarget.path` |
| `startedAt` | string | ISO-8601 UTC timestamp |
| `version` | string | Tool version (aids future compatibility checks) |

Location: `<stateRoot>/instances/<repoKey>/server.json`, where `stateRoot` is `$AGENT_VISUALIZER_STATE_DIR` or `~/.agent-visualizer`, and `repoKey = <slug(basename)>-<first 8 hex of sha1(repoPath)>`.

### Lifecycle

```
(absent) --start, no live record--> WRITTEN --SIGINT/SIGTERM--> (absent)
(stale record) --start--> overwritten --> WRITTEN
WRITTEN (live) --second start for same repo--> second process exits, record untouched
WRITTEN --SIGKILL/crash--> STALE (next start replaces it)
```

A record is **live** iff its PID is running and `GET http://127.0.0.1:<port>/api/health` answers within 500 ms with the same `repoPath`; otherwise **stale**. Removal only happens if the on-disk `pid` equals the current process's PID.

## HealthResponse
See `contracts/http-api.md`: `{ status: "ok", repoPath, repoName, version }`.
