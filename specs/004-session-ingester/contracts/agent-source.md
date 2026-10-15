# Contract: AgentSource

Defined in `src/agents/source.ts`. Consumers (the `/api/sessions` route now, brain slots in 006, the combined source in 005) depend only on this interface. Field types are in [../data-model.md](../data-model.md).

```ts
export interface AgentSource {
  /** Stable source name, e.g. "transcripts". */
  readonly name: string;
  /** Do one full pass, then keep watching. Resolves after the first pass. Idempotent. */
  start(): Promise<void>;
  /** Stop watching and release timers. After it resolves, no events are emitted. Idempotent. */
  stop(): Promise<void>;
  /** Current sessions (all of them, main or not), in no particular order. A fresh array each call. */
  sessions(): AgentSession[];
  /** Register a listener; returns an unsubscribe function. */
  subscribe(listener: (event: AgentSourceEvent) => void): () => void;
  /** Recent ingest problems, oldest first (at most 200). */
  issues(): IngestIssue[];
}
```

## Guarantees

1. After `start()` resolves, `sessions()` reflects every file present at the start of the pass.
2. A listener subscribed before `start()` receives `session-added` for each initial session.
3. `state-changed` is emitted exactly once per actual change of a session's `state`, never for a no-op, with `from !== to`.
4. `session-added` precedes any `state-changed` or `session-updated` for that session.
5. After an unsubscribe function is called, that listener receives nothing more.
6. After `stop()` resolves, no listener receives anything and no timer or handle stays open (a test can `start()`/`stop()` and the process exits).
7. A listener that throws does not stop other listeners or the source; the error is recorded nowhere else (listeners own their errors).
8. Sessions reported by one source never share a `sessionId` (duplicates resolved as in research R8).
9. A change in a session's running-subagent count that does not change its `state` emits `session-updated`, not `state-changed`.

## Transcript source factory

```ts
export interface TranscriptSourceOptions {
  root: string;                    // transcripts root, e.g. ~/.claude/projects
  mainAgentPattern: RegExp;
  pollIntervalMs?: number;         // default 500; 0 disables the timer (tests call refresh())
  resolveProject?: (cwd: string) => Promise<ProjectRef>; // default: git-based resolver (research R7)
}

export function createTranscriptSource(options: TranscriptSourceOptions): AgentSource & {
  /** Run one pass now (stat, read changed files, emit events). Resolves when the pass is done. */
  refresh(): Promise<void>;
};
```

## Stub source (tests)

`tests/stub-agent-source.ts` exports `createStubAgentSource(initial: AgentSession[])` returning an `AgentSource` plus `emit(event)` and `setSessions(sessions)`, used to test consumers without transcripts (spec US6).
