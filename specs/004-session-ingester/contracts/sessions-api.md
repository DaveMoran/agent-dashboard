# Contract: `GET /api/sessions`

Types live in `src/contract/sessions.ts`, which imports nothing from `src/server/`, `src/agents/` or `src/core/`.

```ts
export type SessionState = "working" | "standby"; // 005 adds "waiting"

export interface SessionView {
  sessionId: string;
  model: string;
  cwd: string;
  state: SessionState;
  stateSince: string | null;   // ISO 8601
  lastActivity: string;        // ISO 8601
}

export interface ProjectView {
  id: string;                  // git common dir, or cwd outside git
  name: string;
  lastActivity: string;        // max over its sessions
  sessions: SessionView[];     // main-agent sessions only, lastActivity descending
}

export interface SessionsResponse {
  projects: ProjectView[];     // only projects with ≥ 1 main session, lastActivity descending
}
```

## Behaviour

- `GET /api/sessions` → `200`, `Content-Type: application/json`, body `SessionsResponse`.
- Other methods → `405` with `Allow: GET` (same as `/api/health`).
- Only sessions with `isMain: true` are included. A main session always has `model`, `cwd` and `lastActivity`, so the view fields are non-null except `stateSince`.
- Ties in `lastActivity` are broken by `sessionId` / `id` ascending, so output is deterministic.
- If the server was started without an agent source, the body is `{ "projects": [] }`.
- The mapping is the pure function `buildSessionsResponse(sessions: AgentSession[]): SessionsResponse` in `src/server/sessions.ts`.

## Example

```json
{
  "projects": [
    {
      "id": "/Users/me/Sites/agent-visualizer/.git",
      "name": "agent-visualizer",
      "lastActivity": "2026-10-15T10:03:05.100Z",
      "sessions": [
        {
          "sessionId": "7ec15f17-34b7-46b3-8616-2a43c9b59191",
          "model": "claude-opus-5-5",
          "cwd": "/Users/me/Sites/agent-visualizer",
          "state": "standby",
          "stateSince": "2026-10-15T10:03:05.000Z",
          "lastActivity": "2026-10-15T10:03:05.100Z"
        }
      ]
    }
  ]
}
```
