import type { SessionState } from "../../contract/sessions";
import type { SessionStateT } from "./session-state";

export function isSubagentRunning(agentId: string, sub: SessionStateT, parent: SessionStateT): boolean {
  if (parent.ended || sub.state !== "working") return false;
  const notified = parent.completedAgentIds[agentId];
  if (notified === undefined) return true;
  if (sub.lastActivity === undefined) return false;
  return Date.parse(sub.lastActivity) > Date.parse(notified);
}

export function combineState(turnState: SessionState, runningSubagents: number): SessionState {
  return turnState === "working" || runningSubagents > 0 ? "working" : "standby";
}
