# Attention fixtures

Used by the spec 005 attention source tests. Each scenario is a directory with `projects/-repo/<session>.jsonl` (plus subagent files where listed) and `events.jsonl`. Placeholders (`{{REPO}}`) are filled by `materializeAttention` in `tests/attention-fixtures.ts`. Session IDs are `a0050000-0000-0000-0000-0000000000NN`.

| Scenario | Session | Expected final state |
|---|---|---|
| `permission-main/` | S01 (01) | `standby` |
| `question-main/` | S02 (02) | `standby` |
| `interrupted-wait/` | S03 (03) | `standby` |
| `subagent-wait/` | S04 (04) | `standby`, 0 running subagents |
| `main-wait-bg-subagent/` | S05 (05) | `working`, 1 running subagent |
| `unsorted-events/` | S06 (06) | `working` |
| `unsorted-events/` | S07 (07) | `waiting` since `10:00:05` |
| `session-end/` | S08 (08) | not listed (ended) |
| `session-end/` | S09 (09) | `standby` |
| `late-session/` | S10 (10) | `waiting` since `10:00:02` once its transcript is moved from `later/` into `projects/` within the hold time |
| `malformed-events/` | S11 (11) | `working` after the partial last line is completed |

The `malformed-events/events.jsonl` file deliberately ends without a trailing newline.
