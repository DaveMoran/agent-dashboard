# Contract: AgentSource changes and the attention source

Builds on [004's AgentSource contract](../../004-session-ingester/contracts/agent-source.md). Everything there still holds unless changed here.

## Interface change (`src/agents/source.ts`)

```ts
export type AgentSourceEvent =
  | { type: "session-added"; session: AgentSession }
  | { type: "session-updated"; session: AgentSession }
  | { type: "state-changed"; sessionId: string; projectId: string; from: SessionState; to: SessionState; at: string; session: AgentSession }
  | { type: "session-ended"; sessionId: string; projectId: string; at: string }; // NEW
```

`SessionState` (from `src/contract/sessions.ts`) is now `"working" | "standby" | "waiting"`.

Added guarantees:

10. `session-ended` is emitted at most once per ending. After it, `sessions()` no longer includes that session, and no `state-changed` or `session-updated` is emitted for it until a `session-added` brings it back.
11. Sources that cannot tell when a session ends (the transcript source) never emit `session-ended`.

## Transcript source additions (`src/agents/transcripts/source.ts`)

These are transcript-specific extras on the factory's return type, not part of `AgentSource`:

```ts
export interface AgentClears {
  /** Latest turn-entry timestamp in the main transcript (research R4). */
  main: string | undefined;
  /** Per subagent ID: latest turn-entry timestamp in its transcript, or its completion time if later. */
  subagents: Record<string, string | undefined>;
  /** Latest turn-entry timestamp across main and subagents (used for session end, R8). */
  lastTurnAt: string | undefined;
}

createTranscriptSource(options): AgentSource & {
  refresh(): Promise<void>;
  /** Clear times for a session ID currently reported, else undefined. */
  clears(sessionId: string): AgentClears | undefined;
  /** Called with a session ID after each pass in which that session read new entries. Returns unsubscribe. */
  onActivity(listener: (sessionId: string) => void): () => void;
};
```

The reducer `SessionStateT` gains `lastTurnAt: string | undefined`, the max timestamp of entries whose kind is not `other`.

## Attention source (`src/agents/attention/source.ts`)

```ts
export interface AttentionSourceOptions {
  base: AgentSource & Pick<ReturnType<typeof createTranscriptSource>, "clears" | "onActivity">;
  eventsFile: string;              // <state-root>/hooks/events.jsonl
  pollIntervalMs?: number;         // default 500; 0 disables the timer (tests call refresh())
  holdMs?: number;                 // default 600_000 (FR-011)
  now?: () => number;              // default Date.now
}

export interface HookStatus { seen: boolean; lastEventAt: string | null }

export function createAttentionSource(options: AttentionSourceOptions): AgentSource & {
  refresh(): Promise<void>;        // read new event lines and recompute affected sessions
  hookStatus(): HookStatus;
};
```

Behaviour:

- `name` is `"attention"`. `start()` starts the base source first (if not already started), then reads the whole events file once, then polls. `stop()` stops both. `issues()` returns the base's issues followed by its own (at most 200 in total).
- `sessions()` returns the base's sessions minus ended ones, each with `state` and `stateSince` replaced by the combined values (pure function in `src/agents/attention/combine.ts`, research R5). All other fields pass through unchanged.
- It re-emits the base's events with combined state. It emits its own `state-changed` when a hook event or base activity changes a session's combined state, with `at` = the timestamp of the hook event or transcript entry that caused it. It never emits a `state-changed` where `from === to`.
- With an empty or missing events file, `sessions()` and every emitted event equal the base's (FR-016).
