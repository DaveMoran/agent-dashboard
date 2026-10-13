# Contract: `agent-visualizer.config.json` (v2)

Supersedes `specs/001-server-skeleton/contracts/config-file.md`. Location, precedence and existing error behavior are unchanged; v2 adds one optional key.

## Location (first match wins, no merging)

1. `<repo-path>/agent-visualizer.config.json`
2. `<current working directory>/agent-visualizer.config.json`

## Schema (v2)

```json
{
  "port": 4317,
  "adapter": "some-adapter-name"
}
```

| Key | Type | Required | Notes |
|---|---|---|---|
| `port` | integer 1-65535 | no | Unchanged from v1. Overridden by `--port`. |
| `adapter` | non-empty string | no | Forces the named adapter instead of auto-detection. |

Unknown keys are still ignored.

## Errors (exit code 1)

- `adapter` present but not a non-empty string: `Invalid config in <file>: "adapter" must be a non-empty string, got <value>`
- `adapter` names no registered adapter (checked at CLI startup): `Unknown adapter "<name>". Available adapters: <comma-separated names>` or `Available adapters: none registered`
- Existing v1 errors are unchanged.
