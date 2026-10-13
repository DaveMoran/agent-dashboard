# Data Model: Common Spec Model and Adapter Contract

All types live in `src/core/model.ts` unless noted. Nothing is persisted.

## Constants

- `STATUSES = ["drafted", "planned", "ready", "in-progress", "review", "done", "blocked"] as const`; `SpecStatus` is the union.
- `ROLES = ["planner", "coder", "human", "git"] as const`; `Role` is the union.

## Spec (accepted)

| Field | Type | Rules |
|---|---|---|
| `id` | string | Required, non-empty. Unique within a snapshot (first occurrence wins). |
| `title` | string | If missing or empty, set to `id` and issue `missing-title`. |
| `status` | SpecStatus | Must be in `STATUSES`, else the spec is excluded with `invalid-status`. |
| `dependsOn` | string[] | Defaults to `[]`. Non-string entries are dropped with `invalid-shape`. |
| `tasks` | Task[] | Defaults to `[]`. Order preserved. |
| `artifacts` | string[] | Defaults to `[]`. Paths as the adapter reports them. |
| `branch` | string? | Optional. |
| `source` | SpecSource? | Optional: `{ root: string; branch?: string }`, the root the spec was read from. |

Unknown fields in raw adapter output are dropped.

## Task

| Field | Type | Rules |
|---|---|---|
| `id` | string | Required, non-empty. Duplicates within a spec: both kept, issue `duplicate-task-id`. |
| `text` | string | Required. |
| `done` | boolean | Required. |
| `phase` | string? | Present only if supplied. |
| `parallel` | boolean? | Present only if supplied. |

A task missing `id`, `text` or `done`, or with wrong types, is dropped with issue `invalid-task`; the spec is kept.

## Event

| Field | Type | Rules |
|---|---|---|
| `ts` | string | ISO-8601; must parse as a date. |
| `role` | Role | Must be in `ROLES`. |
| `specId` | string? | Optional. |
| `kind` | string | Required, non-empty. Open set (e.g. `prompt`, `file-edit`, `bash`, `test-run`, `commit`, `status-change`, `spec-created`). |
| `detail` | unknown | Free-form, JSON-compatible. |

`validateEvent(raw)` returns `{ ok: true, event }` or `{ ok: false, reason }` where `reason` names the field.

## Issue

| Field | Type | Notes |
|---|---|---|
| `kind` | IssueKind | See catalogue below. |
| `specId` | string? | Spec concerned, when known. |
| `taskId` | string? | Task concerned, for task-level issues. |
| `message` | string | Human-readable, names the values involved. |
| `related` | string[]? | Other spec ids involved (unresolved target, cycle members). |

### Issue catalogue

| Kind | When | Effect on spec |
|---|---|---|
| `invalid-shape` | Not an object, missing/empty `id`, wrong-typed list | Spec dropped if `id` unusable; otherwise bad entries dropped |
| `missing-title` | No usable title | Kept; title = id |
| `invalid-status` | Status not in `STATUSES` | Dropped |
| `invalid-task` | Malformed task | Task dropped, spec kept |
| `duplicate-task-id` | Two tasks share an id | Both kept |
| `duplicate-id` | Spec id already seen | Later one dropped |
| `unresolved-dependency` | `dependsOn` names an unknown id | Kept |
| `self-dependency` | Spec depends on itself | Kept |
| `dependency-cycle` | Strongly connected component of 2+ specs | Kept; one issue per cycle, `related` sorted |
| `unreadable-path` | A watched root or matched file cannot be read | Scan continues |
| `detect-failed` | An adapter's `detect` threw | Adapter treated as not matching |

Issues are returned in a deterministic order: shape and per-spec issues in adapter order, then duplicate ids, then dependency issues sorted by spec id.

## Snapshot

| Field | Type | Notes |
|---|---|---|
| `specs` | Spec[] | Accepted specs, adapter order. |
| `issues` | Issue[] | All issues for this scan. |
| `adapter` | string \| null | Name of the adapter used, or null when none. |
| `scannedAt` | string | ISO-8601 time the scan finished. |

## Adapter selection result (registry)

| Field | Type | Notes |
|---|---|---|
| `adapter` | Adapter \| null | Selected adapter. |
| `matched` | string[] | Names of every adapter whose `detect` returned true, registration order. |
| `forced` | boolean | True when chosen by the config key. |
| `warnings` | string[] | e.g. forced adapter did not recognize the repo. |
| `issues` | Issue[] | `detect-failed` entries. |

## Notification (watcher)

A tagged union; see `contracts/watcher.md`.

| `type` | Payload |
|---|---|
| `initial` | `snapshot` |
| `spec-changed` | `snapshot` |
| `error` | `error: { stage: "discover" \| "parse"; message: string }` and `snapshot` (the last good one, or an empty snapshot if none yet) |

### Watcher lifecycle

```
start -> scan -> emit initial -> idle
idle --matching change--> pending (quiet timer; max-wait timer started on first change)
pending --quiet elapsed or max wait reached--> scanning
scanning --ok--> emit spec-changed -> idle (or pending, if changes arrived during the scan)
scanning --failure--> emit error (keep last good) -> idle/pending
any --stop()--> stopped (no further notifications, watchers closed, timers cleared)
```
