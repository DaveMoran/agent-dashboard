# Data Model: Attention Hook

Extends the [004 data model](../004-session-ingester/data-model.md). Times are ISO-8601 strings and are compared with `Date.parse`.

## HookEvent (one events-file line, as read)

| Field | Type | Rule |
|---|---|---|
| `ts` | string | required, must parse as a date |
| `sessionId` | string | required (`session` in the file) |
| `cwd` | string \| undefined | not used for state |
| `event` | string | required, the hook event name |
| `type` | string \| undefined | the notification type, tool name or end reason |
| `agentId` | string \| undefined | present for events raised inside a subagent |
| `meaning` | `"wait-start" \| "wait-end" \| "session-end" \| "ignored"` | from the mapping in [contracts/hook-events.md](./contracts/hook-events.md) |
| `agentKey` | string | `""` for the main agent, else `agentId` |

## AttentionRecord (per session ID, in the attention source)

| Field | Type | Rule |
|---|---|---|
| `waitAt` | `Map<agentKey, string>` | max `ts` of `wait-start` events per agent |
| `hookClearAt` | `Map<agentKey, string>` | max `ts` of `wait-end` events per agent |
| `endAt` | string \| undefined | max `ts` of `session-end` events |
| `lastHookAt` | string \| undefined | max `ts` of events other than `session-end`, `ignored` included |
| `newestAt` | string \| undefined | max `ts` of every event, used for the hold timeout |
| `ended` | boolean | last emitted ended state (to emit `session-ended` once) |
| `state`, `stateSince` | combined values last reported | to emit `state-changed` exactly once |

Records whose session the base source doesn't know are dropped when `now() - newestAt > holdMs` (FR-011).

## AgentClears (from the transcript source)

See [contracts/agent-source.md](./contracts/agent-source.md). `main` and each `subagents[id]` are that transcript's `lastTurnAt`; for a subagent, it is replaced by its completion time from the parent's `completedAgentIds` when that is later.

## Combined state (pure: `combine(base, record, clears)`)

```
agentWaiting(k) = waitAt[k] defined
                  and waitAt[k] > max(hookClearAt[k], clearOf(k))      // a tie counts as cleared
clearOf("")     = clears.main
clearOf(id)     = clears.subagents[id]          // undefined if the subagent is unknown

waiting         = some k with agentWaiting(k)
ended           = endAt defined and endAt > max(clears.lastTurnAt, lastHookAt)
state           = waiting ? "waiting" : base.state
```

The function is a pure fold over maxima, so it is independent of input order (FR-010).

### Transitions

```
working  --wait-start later than agent's clears-->  waiting
standby  --wait-start later than agent's clears-->  waiting   (for example a background subagent asks)
waiting  --every waiting agent cleared-->           base state (working | standby)
any      --session-end later than last turn and last hook-->  ended (not listed)
ended    --later turn entry or hook event-->        listed again (session-added)
```

`stateSince` takes the `ts` of the hook event, or the timestamp of the transcript entry, that caused the transition. When the combined state equals the base state and nothing hook-driven changed, it is the base's `stateSince`.

## HookStatus

`{ seen: boolean, lastEventAt: string | null }`, updated with every valid line read (FR-015).

## Session state (contract)

`SessionState = "working" | "standby" | "waiting"`.
