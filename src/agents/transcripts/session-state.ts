import type { SessionState } from "../../contract/sessions";
import type { EntryKind, TranscriptEntry } from "./entry";

export interface SessionStateT {
  sessionId: string | undefined;
  model: string | undefined;
  cwd: string | undefined;
  state: SessionState;
  stateSince: string | undefined;
  lastActivity: string | undefined;
  openToolUseIds: string[];
  completedAgentIds: Record<string, string>;
  ended: boolean;
  sawModel: boolean;
  sawStateEntry: boolean;
}

export function initialSessionState(): SessionStateT {
  return {
    sessionId: undefined,
    model: undefined,
    cwd: undefined,
    state: "standby",
    stateSince: undefined,
    lastActivity: undefined,
    openToolUseIds: [],
    completedAgentIds: {},
    ended: false,
    sawModel: false,
    sawStateEntry: false,
  };
}

const WORKING: ReadonlySet<EntryKind> = new Set(["prompt", "tool-call", "tool-result", "progress"]);
const STANDBY: ReadonlySet<EntryKind> = new Set(["final", "turn-end", "interrupt", "session-end"]);

function later(a: string | undefined, b: string | undefined): string | undefined {
  if (b === undefined) return a;
  if (a === undefined) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

export function applyEntry(state: SessionStateT, entry: TranscriptEntry): SessionStateT {
  const next: SessionStateT = {
    ...state,
    openToolUseIds: [...state.openToolUseIds],
    completedAgentIds: { ...state.completedAgentIds },
  };

  if (entry.sessionId !== undefined) next.sessionId = entry.sessionId;
  if (entry.cwd !== undefined) next.cwd = entry.cwd;
  if (entry.model !== undefined) {
    next.model = entry.model;
    next.sawModel = true;
  }
  next.lastActivity = later(state.lastActivity, entry.timestamp);

  if (WORKING.has(entry.kind) || STANDBY.has(entry.kind)) {
    const target: SessionState = WORKING.has(entry.kind) ? "working" : "standby";
    if (target !== state.state) {
      next.state = target;
      next.stateSince = entry.timestamp;
    }
    next.sawStateEntry = true;
  }

  if (entry.kind === "session-end") next.ended = true;
  else if (WORKING.has(entry.kind)) next.ended = false;

  if (entry.kind === "tool-call") {
    for (const id of entry.toolUseIds) {
      if (!next.openToolUseIds.includes(id)) next.openToolUseIds.push(id);
    }
  } else if (entry.kind === "tool-result") {
    next.openToolUseIds = next.openToolUseIds.filter((id) => !entry.toolUseIds.includes(id));
  } else if (STANDBY.has(entry.kind)) {
    next.openToolUseIds = [];
  }

  if (entry.timestamp !== undefined) {
    for (const id of entry.completedAgentIds) next.completedAgentIds[id] = entry.timestamp;
  }
  return next;
}
