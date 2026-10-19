# Contract: HTTP API changes

## `GET /api/magi` (new)

Types in `src/contract/magi.ts` (imports nothing):

```ts
export type BrainState = "not-active" | "standby" | "working" | "waiting";
export type BrainName = "MELCHIOR" | "BALTHASAR" | "CASPER";

export interface BrainProject {
  id: string;   // 004 project identity (git common dir, or cwd outside git)
  name: string; // 004 project name
  path: string; // repo's main working directory (dirname of id when id ends in /.git), else id
}

export interface BrainView {
  number: 1 | 2 | 3;
  name: BrainName;
  state: BrainState;
  stateSince: string | null; // ISO 8601; null only for a brain free since start
  project: BrainProject | null; // null iff state === "not-active"
}

export interface MagiResponse {
  brains: BrainView[]; // always exactly 3, ordered by number: MELCHIOR, BALTHASAR, CASPER
}
```

- `GET` only; other methods → `405` with `Allow: GET` (as for the other API routes).
- Queued projects never appear.
- With no MAGI service wired (route-level tests), the response is three `not-active` brains with `stateSince: null` and `project: null`.

Example:

```json
{
  "brains": [
    { "number": 1, "name": "MELCHIOR", "state": "working", "stateSince": "2026-10-18T10:05:00.000Z",
      "project": { "id": "/Users/me/agent-visualizer/.git", "name": "agent-visualizer", "path": "/Users/me/agent-visualizer" } },
    { "number": 2, "name": "BALTHASAR", "state": "not-active", "stateSince": null, "project": null },
    { "number": 3, "name": "CASPER", "state": "not-active", "stateSince": null, "project": null }
  ]
}
```

## `GET /api/health` (changed)

`repoPath` and `repoName` become `string | null` in `src/contract/health.ts`; both are `null` when the visualizer was started without a repo path. Other fields unchanged.

```json
{ "status": "ok", "repoPath": null, "repoName": null, "version": "0.1.0",
  "attentionHook": { "seen": false, "lastEventAt": null } }
```

## `GET /api/sessions`

Unchanged.
