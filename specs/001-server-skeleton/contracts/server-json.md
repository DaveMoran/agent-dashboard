# Contract: `server.json` Instance Record

Written by a running visualizer so other tools (e.g. the future double-agent launcher skill) can discover it without scanning ports.

## Location

```
$AGENT_VISUALIZER_STATE_DIR/instances/<repo-key>/server.json
# default state root: ~/.agent-visualizer
# repo-key = <slug of repo basename>-<first 8 hex of sha1(absolute real repo path)>
```

Never inside the target repo. The directory is created (mode `0700`) if absent.

## Format

```json
{
  "port": 4318,
  "pid": 48213,
  "repoPath": "/Users/me/Sites/my-app",
  "startedAt": "2026-10-12T14:03:22.114Z",
  "version": "0.1.0"
}
```

| Field | Type | Notes |
|---|---|---|
| `port` | integer | Port actually bound |
| `pid` | integer | Server process ID |
| `repoPath` | string | Absolute real path |
| `startedAt` | string | ISO-8601 UTC |
| `version` | string | Tool version |

## Semantics for readers

An instance is **live** if `pid` is running and `GET http://127.0.0.1:<port>/api/health` returns `repoPath` equal to the record's. Otherwise treat the record as stale. Readers MUST NOT delete records they did not create.

## Writer behavior

- Written atomically (temp file in the same directory, then rename) after the port is bound.
- Replaces a stale record; refuses to start if the existing record is live.
- Removed on SIGINT/SIGTERM/normal exit, only if the on-disk `pid` equals the current PID.
