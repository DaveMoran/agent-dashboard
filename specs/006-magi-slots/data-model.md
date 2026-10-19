# Data Model: MAGI Slots

All of this is in memory and recomputed from the agent source; nothing is persisted except the instance record (R1).

## Input: AgentSession (unchanged, from 004/005)

Used fields: `sessionId`, `projectId`, `projectName`, `isMain`, `state` (`working | standby | waiting`), `stateSince`, `lastActivity`. Ended sessions (005) are absent from `sessions()`.

## SlotOptions

| Field | Type | Rule |
|---|---|---|
| `idleMs` | number | > 0; from `idleTimeoutMinutes` (default 30) |
| `waitingMs` | number | > 0; from `waitingTimeoutMinutes` (default 240) |

## Live main session (derived per step)

A session is live at `nowMs` iff `isMain`, `lastActivity` is defined and parses, and `nowMs - Date.parse(lastActivity) <= (state === "waiting" ? waitingMs : idleMs)`. A future `lastActivity` (negative age) is live. Its **expiry** is `lastActivity + timeout`.

## Active project (derived per step)

| Field | Rule |
|---|---|
| `id` | `projectId` |
| `name` | `projectName` of its most recently active live main session |
| `path` | `projectPath(id)` (R6) |
| `activity` | max `lastActivity` over its live main sessions |
| `state` | `waiting` if any live main session waits, else `working` if any works, else `standby` |

## Brain

| Field | Type | Rule |
|---|---|---|
| `number` | `1 \| 2 \| 3` | fixed |
| `name` | `"MELCHIOR" \| "BALTHASAR" \| "CASPER"` | fixed by number |
| `project` | `{ id, name, path } \| null` | assigned project, or null when free |
| `state` | `"not-active" \| "standby" \| "working" \| "waiting"` | `not-active` iff `project` is null, else the project's state |
| `stateSince` | ISO string or null | R5 |

Invariants: exactly three brains; no project on two brains; a brain's `project.id` stays the same from the step it is assigned until the step its project is not active.

## SlotState (what `stepSlots` carries between steps)

| Field | Type | Meaning |
|---|---|---|
| `brains` | three `Brain` | as above |
| `prevLive` | `Map<sessionId, projectId>` | live main sessions at the previous step. A session in it that is not live now has dropped: if it is still in `sessions()` (timed out, or no longer main) its drop time is its expiry, capped at `now`; if it is gone (ended), its drop time is `now` (R5) |
| `started` | boolean | false before the first step; the first step uses session timestamps for take times (R5) |

`emptySlotState()` returns three free brains with `stateSince: null`, empty `prevLive`, `started: false`.

## Brain lifecycle

```
not-active ──project becomes active and this is the lowest free brain (or newest queued)──► standby | working | waiting
standby ⇄ working ⇄ waiting   (combined over live main sessions; project unchanged)
any active state ──project has no live main session (all ended or timed out)──► not-active
```

## Instance record (extended)

`{ port, pid, repoPath: string | null, startedAt, version }`. `repoPath: null` ⇔ path-less instance at `<state-root>/magi/server.json`.

## Config (extended)

`Config` gains `idleTimeoutMinutes: number | undefined` and `waitingTimeoutMinutes: number | undefined`, validated as finite numbers > 0.
