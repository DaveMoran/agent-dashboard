export type EntryKind =
  | "prompt"
  | "tool-call"
  | "tool-result"
  | "progress"
  | "final"
  | "turn-end"
  | "interrupt"
  | "session-end"
  | "other";

export interface TranscriptEntry {
  kind: EntryKind;
  timestamp: string | undefined;
  sessionId: string | undefined;
  cwd: string | undefined;
  model: string | undefined;
  toolUseIds: string[];
  completedAgentIds: string[];
}

export type ClassifyIssue = {
  reason: "invalid-json" | "not-an-object" | "missing-field";
  field?: string;
};

export type ClassifyResult = { entry: TranscriptEntry } | { issue: ClassifyIssue };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const OTHER_PREFIXES = [
  "<command-name>",
  "<local-command-",
  "<bash-input>",
  "<bash-stdout>",
  "<bash-stderr>",
];

function blocksOfType(content: unknown, type: string): Obj[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is Obj => isObj(b) && b.type === type);
}

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  const first = blocksOfType(content, "text")[0];
  return first ? (str(first.text) ?? "") : "";
}

function completedIds(text: string): string[] {
  if (!/<status>[\s\S]*?<\/status>/.test(text)) return [];
  const ids: string[] = [];
  for (const m of text.matchAll(/<task-id>([\s\S]*?)<\/task-id>/g)) {
    if (m[1] !== undefined) ids.push(m[1]);
  }
  return ids;
}

export function classifyLine(line: string): ClassifyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { issue: { reason: "invalid-json" } };
  }
  if (!isObj(parsed)) return { issue: { reason: "not-an-object" } };
  const type = parsed.type;
  if (typeof type !== "string") return { issue: { reason: "missing-field", field: "type" } };

  const timestamp = str(parsed.timestamp);
  const make = (
    kind: EntryKind,
    extra: Partial<Pick<TranscriptEntry, "model" | "toolUseIds" | "completedAgentIds">> = {},
  ): ClassifyResult => ({
    entry: {
      kind,
      timestamp,
      sessionId: str(parsed.sessionId),
      cwd: str(parsed.cwd),
      model: extra.model,
      toolUseIds: extra.toolUseIds ?? [],
      completedAgentIds: extra.completedAgentIds ?? [],
    },
  });
  const missingTs: ClassifyResult = { issue: { reason: "missing-field", field: "timestamp" } };
  const message = isObj(parsed.message) ? parsed.message : undefined;
  const content = message?.content;

  if (type === "user") {
    if (timestamp === undefined) return missingTs;
    if (parsed.isMeta === true) return make("other");
    const results = blocksOfType(content, "tool_result");
    if (results.length > 0) {
      return make("tool-result", {
        toolUseIds: results.map((b) => str(b.tool_use_id)).filter((s): s is string => s !== undefined),
      });
    }
    const text = userText(content);
    if (text.startsWith("[Request interrupted by user")) return make("interrupt");
    if (text.startsWith("<task-notification>")) {
      return make("prompt", { completedAgentIds: completedIds(text) });
    }
    if (OTHER_PREFIXES.some((p) => text.startsWith(p))) return make("other");
    if (
      typeof content === "string"
        ? content.length > 0
        : Array.isArray(content) && content.some((b) => isObj(b) && (b.type === "text" || b.type === "image"))
    ) {
      return make("prompt");
    }
    return make("other");
  }

  if (type === "assistant") {
    if (timestamp === undefined) return missingTs;
    const m = str(message?.model);
    const model = m !== undefined && m !== "" && m !== "<synthetic>" ? m : undefined;
    const calls = blocksOfType(content, "tool_use");
    if (calls.length > 0) {
      return make("tool-call", {
        model,
        toolUseIds: calls.map((b) => str(b.id)).filter((s): s is string => s !== undefined),
      });
    }
    const stop = message?.stop_reason;
    if (stop === null || stop === undefined || stop === "tool_use") return make("progress", { model });
    return make("final", { model });
  }

  if (type === "system") {
    if (parsed.subtype === "turn_duration" && timestamp !== undefined) return make("turn-end");
    return make("other");
  }

  if (type === "attachment") {
    const att = isObj(parsed.attachment) ? parsed.attachment : undefined;
    const prompt = str(att?.prompt);
    if (att?.type === "queued_command" && prompt !== undefined && prompt.startsWith("<task-notification>")) {
      return make("other", { completedAgentIds: completedIds(prompt) });
    }
    return make("other");
  }

  if (type === "continued-in") return timestamp !== undefined ? make("session-end") : make("other");

  return make("other");
}
