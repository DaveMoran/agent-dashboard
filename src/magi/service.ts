import type { AgentSource } from "../agents/source";
import type { BrainView } from "../contract/magi";
import { emptySlotState, type SlotState, stepSlots } from "./slots";

export interface MagiServiceOptions {
  source: AgentSource;
  idleMs: number;
  waitingMs: number;
  now?: () => number;
  tickMs?: number;
}

export interface MagiService {
  start(): void;
  stop(): void;
  refresh(): void;
  brains(): BrainView[];
}

export function createMagiService(options: MagiServiceOptions): MagiService {
  const { source, idleMs, waitingMs, now = Date.now, tickMs = 1000 } = options;
  let state: SlotState = emptySlotState();
  let running = false;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function step(): void {
    if (!running) return;
    state = stepSlots(state, source.sessions(), now(), { idleMs, waitingMs });
  }

  return {
    start() {
      if (running) return;
      running = true;
      unsubscribe = source.subscribe(step);
      step();
      timer = setInterval(step, tickMs);
    },
    stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = null;
      if (timer) clearInterval(timer);
      timer = null;
    },
    refresh: step,
    brains: () => state.brains.map((b) => ({ ...b, project: b.project ? { ...b.project } : null })),
  };
}
