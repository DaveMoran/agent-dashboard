# Contract: HTTP Surface

Server binds `127.0.0.1` only.

## `GET /api/health`

Response `200 application/json`:

```json
{
  "status": "ok",
  "repoPath": "/Users/me/Sites/my-app",
  "repoName": "my-app",
  "version": "0.1.0"
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | `"ok"` | Constant while the server is running |
| `repoPath` | string | Absolute real path (identical to `server.json`) |
| `repoName` | string | Basename of `repoPath` |
| `version` | string | Package version |

Other methods on `/api/health` return `405`. Any other path beginning with `/api/` returns `404` with `{ "error": "not_found" }` (reserved namespace for later features).

## Non-API routes

| Mode | Behavior |
|---|---|
| Production (`AGENT_VISUALIZER_DEV_UI` unset) | Serve files from `dist/web`; unknown paths without a file extension fall back to `index.html`; a missing build returns `503` with a plain-text hint to run `bun run build`. |
| Development (`AGENT_VISUALIZER_DEV_UI=<url>`) | Proxy every HTTP request to the Vite dev server. If Vite is unreachable, return `502`. Vite's HMR WebSocket is not proxied; `vite.config.ts` points the HMR client directly at the Vite dev server port. |

## Placeholder page

Route `/` renders a page that calls `/api/health` and displays `repoName` (and `repoPath` as secondary text). While loading it shows a neutral loading state; if the call fails it shows an error message instead of a blank page.
