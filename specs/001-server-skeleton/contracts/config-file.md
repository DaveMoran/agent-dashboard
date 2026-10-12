# Contract: `agent-visualizer.config.json`

## Location (first match wins, no merging)

1. `<repo-path>/agent-visualizer.config.json`
2. `<current working directory>/agent-visualizer.config.json`

If neither exists the built-in defaults apply, silently.

## Schema (v1)

```json
{
  "port": 4317
}
```

| Key | Type | Required | Notes |
|---|---|---|---|
| `port` | integer 1-65535 | no | Preferred port. Overridden by `--port`. |

Unknown keys are ignored (forward compatible). The top level must be a JSON object.

## Precedence

`--port` flag > config file > built-in default (`4317`).

## Errors (exit code 1)

- Not valid JSON: `Invalid JSON in <file>: <parser message>`
- Top level not an object, or `port` not an integer in range: `Invalid config in <file>: <reason>`
