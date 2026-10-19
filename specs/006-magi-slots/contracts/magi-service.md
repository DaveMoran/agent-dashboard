# Contract: slot logic and MAGI service (server-internal)

Module `src/magi/` is server code; the UI must not import it (add `magi/` to the forbidden pattern in `tests/contract-boundary.test.ts`).

## `src/magi/slots.ts` (pure, no I/O, no clock)

```ts
import type { AgentSession } from "../agents/source";
import type { BrainView } from "../contract/magi";

export interface SlotOptions { idleMs: number; waitingMs: number }

export interface SlotState {
  brains: BrainView[];                 // always 3, numbers 1..3
  prevLive: Map<string, string>;       // sessionId → projectId, live main sessions at the previous step
  started: boolean;
}

export const BRAIN_NAMES: readonly ["MELCHIOR", "BALTHASAR", "CASPER"];
export function emptySlotState(): SlotState;
export function projectPath(projectId: string): string;
export function isLive(session: AgentSession, nowMs: number, options: SlotOptions): boolean;
export function stepSlots(prev: SlotState, sessions: AgentSession[], nowMs: number, options: SlotOptions): SlotState;
```

Rules: the liveness rule is in [data-model.md](../data-model.md), assignment and the queue are research R4, and `stateSince` is R5. `stepSlots` does not mutate `prev` and returns new brain objects. It is deterministic: the same inputs give an identical output. A `stateSince` value is always an ISO string produced by `new Date(ms).toISOString()`, or a session's own `stateSince` copied unchanged.

## `src/magi/service.ts`

```ts
import type { AgentSource } from "../agents/source";
import type { BrainView } from "../contract/magi";

export interface MagiServiceOptions {
  source: AgentSource;
  idleMs: number;
  waitingMs: number;
  now?: () => number;   // default Date.now
  tickMs?: number;      // default 1000
}

export interface MagiService {
  start(): void;        // subscribes to source events, runs one step, starts the timer
  stop(): void;         // unsubscribes, clears the timer
  refresh(): void;      // runs one step now (tests)
  brains(): BrainView[]; // copy of the current three brains
}

export function createMagiService(options: MagiServiceOptions): MagiService;
```

- Every source event triggers one step using `source.sessions()` and `now()`.
- The timer runs one step every `tickMs`, so timeouts free brains without events.
- Before `start()`, `brains()` returns three free brains.

## Wiring

- `src/server/routes.ts`: `HandlerOptions.repo: RepoTarget | null` and `magi?: { brains(): BrainView[] }`; adds `/api/magi`.
- `src/server/start.ts`: passes `repo` (nullable) and `magi` through.
- `src/cli/index.ts`: optional path, `loadConfig(repo?.path)`, timeouts from config (minutes × 60 000), creates the service after `source.start()`, stops it before `source.stop()` on shutdown, and writes the instance record with `repoPath: repo?.path ?? null`.
- `src/server/state.ts`: `instancePath(repoPath: string | null)`; `null` → `<state-root>/magi/server.json`. `writeInstance`, `readInstance`, `removeInstance` and `InstanceRunningError` accept `null`.
