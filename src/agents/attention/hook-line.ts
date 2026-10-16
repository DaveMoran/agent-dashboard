export type HookMeaning = "wait-start" | "wait-end" | "session-end" | "ignored";

export interface HookEvent {
  ts: string;
  sessionId: string;
  cwd: string | undefined;
  event: string;
  type: string | undefined;
  agentId: string | undefined;
  meaning: HookMeaning;
  agentKey: string;
}

export type HookLineIssue =
  | { reason: "invalid-json" }
  | { reason: "not-an-object" }
  | { reason: "missing-field"; field: "ts" | "session" | "event" };

export type HookLineResult = { event: HookEvent } | { issue: HookLineIssue };

export const MAPPED_EVENTS: readonly string[] = [
  "Elicitation",
  "ElicitationResult",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "PreToolUse",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStop",
  "UserPromptSubmit",
];

const WAITING_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function classify(
  event: string,
  type: string | undefined,
  agentId: string | undefined,
): { meaning: HookMeaning; agentKey: string } {
  const agentKey = agentId ?? "";
  const tool = type !== undefined && WAITING_TOOLS.has(type);
  switch (event) {
    case "PermissionRequest":
    case "Elicitation":
      return { meaning: "wait-start", agentKey };
    case "PreToolUse":
      return { meaning: tool ? "wait-start" : "ignored", agentKey };
    case "PostToolUse":
    case "PostToolUseFailure":
      return { meaning: tool ? "wait-end" : "ignored", agentKey };
    case "ElicitationResult":
      return { meaning: "wait-end", agentKey };
    case "UserPromptSubmit":
    case "Stop":
    case "StopFailure":
      return { meaning: "wait-end", agentKey: "" };
    case "SubagentStop":
      return agentId === undefined ? { meaning: "ignored", agentKey: "" } : { meaning: "wait-end", agentKey };
    case "SessionEnd":
      return { meaning: "session-end", agentKey };
    default:
      return { meaning: "ignored", agentKey };
  }
}

export function classifyHookLine(text: string): HookLineResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { issue: { reason: "invalid-json" } };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { issue: { reason: "not-an-object" } };
  }
  const o = raw as Record<string, unknown>;
  const ts = str(o.ts);
  if (ts === undefined || Number.isNaN(Date.parse(ts))) {
    return { issue: { reason: "missing-field", field: "ts" } };
  }
  const sessionId = str(o.session);
  if (sessionId === undefined) return { issue: { reason: "missing-field", field: "session" } };
  const event = str(o.event);
  if (event === undefined) return { issue: { reason: "missing-field", field: "event" } };
  const type = str(o.type);
  const agentId = str(o.agent);
  const { meaning, agentKey } = classify(event, type, agentId);
  return { event: { ts, sessionId, cwd: str(o.cwd), event, type, agentId, meaning, agentKey } };
}
