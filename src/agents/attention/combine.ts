import type { SessionState } from "../../contract/sessions";
import type { AgentClears } from "../transcripts/source";
import type { HookEvent } from "./hook-line";

export interface AttentionRecord {
  waitAt: Record<string, string>;
  hookClearAt: Record<string, string>;
  endAt: string | undefined;
  lastHookAt: string | undefined;
  newestAt: string | undefined;
}

export function emptyRecord(): AttentionRecord {
  return { waitAt: {}, hookClearAt: {}, endAt: undefined, lastHookAt: undefined, newestAt: undefined };
}

/** The later of two timestamps; undefined means never. */
function later(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** True when `a` is defined and strictly later than `b` (undefined = never). */
function isAfter(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined) return false;
  if (b === undefined) return true;
  return Date.parse(a) > Date.parse(b);
}

function withMax(map: Record<string, string>, key: string, ts: string): Record<string, string> {
  const next = later(map[key], ts) as string;
  return { ...map, [key]: next };
}

export function applyHookEvent(record: AttentionRecord, event: HookEvent): AttentionRecord {
  const { meaning, agentKey, ts } = event;
  return {
    waitAt: meaning === "wait-start" ? withMax(record.waitAt, agentKey, ts) : { ...record.waitAt },
    hookClearAt:
      meaning === "wait-end" ? withMax(record.hookClearAt, agentKey, ts) : { ...record.hookClearAt },
    endAt: meaning === "session-end" ? later(record.endAt, ts) : record.endAt,
    lastHookAt: meaning === "session-end" ? record.lastHookAt : later(record.lastHookAt, ts),
    newestAt: later(record.newestAt, ts),
  };
}

function clearOf(key: string, clears: AgentClears | undefined): string | undefined {
  if (clears === undefined) return undefined;
  return key === "" ? clears.main : clears.subagents[key];
}

/** Agent keys still waiting, sorted. A tie with a clear counts as cleared. */
export function waitingAgents(record: AttentionRecord, clears: AgentClears | undefined): string[] {
  return Object.keys(record.waitAt)
    .filter((k) => isAfter(record.waitAt[k], later(record.hookClearAt[k], clearOf(k, clears))))
    .sort();
}

/** Latest wait-start time among agents still waiting, or undefined when nobody waits. */
export function waitSince(record: AttentionRecord, clears: AgentClears | undefined): string | undefined {
  let since: string | undefined;
  for (const k of waitingAgents(record, clears)) since = later(since, record.waitAt[k]);
  return since;
}

export function isEnded(record: AttentionRecord, clears: AgentClears | undefined): boolean {
  return isAfter(record.endAt, later(clears?.lastTurnAt, record.lastHookAt));
}

export function combinedState(
  base: SessionState,
  record: AttentionRecord,
  clears: AgentClears | undefined,
): SessionState {
  return waitingAgents(record, clears).length > 0 ? "waiting" : base;
}
