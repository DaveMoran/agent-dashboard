# Contract: HTTP changes

## `GET /api/sessions`

Unchanged from [004](../../004-session-ingester/contracts/sessions-api.md), except:

- `state` can be `"waiting"` (type `SessionState` in `src/contract/sessions.ts`).
- `stateSince` for a waiting session is the timestamp of the hook event that started the wait. When the wait ends, it is the timestamp of the event or entry that ended it.
- Sessions that have ended (hook `SessionEnd`) are not listed. A project left with no listed sessions is not listed.

## `GET /api/health`

The response gains one field, and the full shape is now typed in `src/contract/health.ts`:

```ts
export interface HealthResponse {
  status: "ok";
  repoPath: string;
  repoName: string;
  version: string;
  attentionHook: {
    seen: boolean;             // true once any valid hook line has been read by this process
    lastEventAt: string | null; // `ts` of the newest valid hook line read, else null
  };
}
```

Example, with the hook installed:

```json
{ "status": "ok", "repoPath": "/Users/me/repo", "repoName": "repo", "version": "0.1.0",
  "attentionHook": { "seen": true, "lastEventAt": "2026-10-15T10:00:00.123Z" } }
```

Without the hook (or with no events file): `"attentionHook": { "seen": false, "lastEventAt": null }`.
