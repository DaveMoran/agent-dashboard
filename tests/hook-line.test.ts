import { expect, test } from "bun:test";
import {
  classifyHookLine,
  type HookEvent,
  type HookMeaning,
  MAPPED_EVENTS,
} from "../src/agents/attention/hook-line";

const TS = "2026-10-15T10:00:00.123Z";
const SID = "0c303220-f66d-480c-8db7-9afc189a2260";
const j = (o: unknown) => JSON.stringify(o);
const line = (o: Record<string, unknown>) => j({ ts: TS, session: SID, ...o });
const ev = (text: string): HookEvent => {
  const r = classifyHookLine(text);
  if (!("event" in r)) throw new Error(`expected event, got ${JSON.stringify(r)}`);
  return r.event;
};

type Row = [event: string, type: string | undefined, meaning: HookMeaning, keyed: "agent" | "main"];
const ROWS: Row[] = [
  ["PermissionRequest", "Bash", "wait-start", "agent"],
  ["PermissionRequest", undefined, "wait-start", "agent"],
  ["PreToolUse", "AskUserQuestion", "wait-start", "agent"],
  ["PreToolUse", "ExitPlanMode", "wait-start", "agent"],
  ["Elicitation", "mcp", "wait-start", "agent"],
  ["Elicitation", undefined, "wait-start", "agent"],
  ["PostToolUse", "AskUserQuestion", "wait-end", "agent"],
  ["PostToolUse", "ExitPlanMode", "wait-end", "agent"],
  ["PostToolUseFailure", "AskUserQuestion", "wait-end", "agent"],
  ["PostToolUseFailure", "ExitPlanMode", "wait-end", "agent"],
  ["ElicitationResult", "mcp", "wait-end", "agent"],
  ["ElicitationResult", undefined, "wait-end", "agent"],
  ["UserPromptSubmit", undefined, "wait-end", "main"],
  ["UserPromptSubmit", "x", "wait-end", "main"],
  ["Stop", undefined, "wait-end", "main"],
  ["Stop", "x", "wait-end", "main"],
  ["StopFailure", undefined, "wait-end", "main"],
  ["StopFailure", "rate_limit", "wait-end", "main"],
];

for (const [event, type, meaning, keyed] of ROWS) {
  test(`${event} type=${type ?? "(none)"} without agent is ${meaning}, agentKey ""`, () => {
    const e = ev(line({ event, ...(type === undefined ? {} : { type }) }));
    expect(e.meaning).toBe(meaning);
    expect(e.agentKey).toBe("");
  });
  test(`${event} type=${type ?? "(none)"} with agent is ${meaning}, agentKey ${keyed === "agent" ? "agent" : '""'}`, () => {
    const e = ev(line({ event, agent: "sub1", ...(type === undefined ? {} : { type }) }));
    expect(e.meaning).toBe(meaning);
    expect(e.agentKey).toBe(keyed === "agent" ? "sub1" : "");
    expect(e.agentId).toBe("sub1");
  });
}

test("SubagentStop with agent is wait-end keyed by the agent", () => {
  const e = ev(line({ event: "SubagentStop", agent: "sub1" }));
  expect(e.meaning).toBe("wait-end");
  expect(e.agentKey).toBe("sub1");
});
test("SubagentStop with any type and agent is wait-end", () => {
  const e = ev(line({ event: "SubagentStop", type: "x", agent: "sub2" }));
  expect(e.meaning).toBe("wait-end");
  expect(e.agentKey).toBe("sub2");
});
test("SubagentStop without agent is ignored", () => {
  expect(ev(line({ event: "SubagentStop" })).meaning).toBe("ignored");
});

test("SessionEnd is session-end", () => {
  expect(ev(line({ event: "SessionEnd" })).meaning).toBe("session-end");
  expect(ev(line({ event: "SessionEnd", type: "logout" })).meaning).toBe("session-end");
});

test("PreToolUse for other tools is ignored", () => {
  for (const type of ["Bash", "Read", "Edit", "askuserquestion"]) {
    expect(ev(line({ event: "PreToolUse", type })).meaning).toBe("ignored");
  }
  expect(ev(line({ event: "PreToolUse" })).meaning).toBe("ignored");
});
test("PostToolUse and PostToolUseFailure for other tools are ignored", () => {
  for (const event of ["PostToolUse", "PostToolUseFailure"]) {
    expect(ev(line({ event, type: "Bash" })).meaning).toBe("ignored");
    expect(ev(line({ event })).meaning).toBe("ignored");
  }
});
test("unknown events are ignored", () => {
  for (const event of ["Notification", "SessionStart", "PreCompact", "Whatever", ""]) {
    const e = ev(line({ event }));
    expect(e.meaning).toBe("ignored");
    expect(e.event).toBe(event);
  }
});
test("an ignored event without agent has agentKey empty", () => {
  expect(ev(line({ event: "Whatever" })).agentKey).toBe("");
});

test("full line maps every field", () => {
  const e = ev(
    line({
      cwd: "/Users/me/repo",
      event: "PermissionRequest",
      type: "Bash",
      agent: "aabcc9e032d23a66b",
    }),
  );
  expect(e).toStrictEqual({
    ts: TS,
    sessionId: SID,
    cwd: "/Users/me/repo",
    event: "PermissionRequest",
    type: "Bash",
    agentId: "aabcc9e032d23a66b",
    meaning: "wait-start",
    agentKey: "aabcc9e032d23a66b",
  });
});

test("optional fields are undefined when absent, and the key set is exact", () => {
  const e = ev(line({ event: "Stop" }));
  expect(e.cwd).toBeUndefined();
  expect(e.type).toBeUndefined();
  expect(e.agentId).toBeUndefined();
  expect(Object.keys(e).sort()).toEqual(
    ["agentId", "agentKey", "cwd", "event", "meaning", "sessionId", "ts", "type"].sort(),
  );
});

test("ts is passed through unchanged", () => {
  expect(ev(line({ event: "Stop", ts: "2026-10-15T10:00:00Z" })).ts).toBe("2026-10-15T10:00:00Z");
});

test("trailing newline on the line is tolerated", () => {
  expect(ev(`${line({ event: "Stop" })}\n`).event).toBe("Stop");
});

test("issue: invalid JSON", () => {
  expect(classifyHookLine("{nope")).toStrictEqual({ issue: { reason: "invalid-json" } });
  expect(classifyHookLine("")).toStrictEqual({ issue: { reason: "invalid-json" } });
});
test("issue: not an object", () => {
  for (const l of ["[1]", "null", "3", '"s"', "true"]) {
    expect(classifyHookLine(l)).toStrictEqual({ issue: { reason: "not-an-object" } });
  }
});
test("issue: ts missing, not a string or unparseable", () => {
  const bad: Record<string, unknown>[] = [
    { session: SID, event: "Stop" },
    { ts: 123, session: SID, event: "Stop" },
    { ts: null, session: SID, event: "Stop" },
    { ts: "not a date", session: SID, event: "Stop" },
  ];
  for (const o of bad) {
    expect(classifyHookLine(j(o))).toStrictEqual({
      issue: { reason: "missing-field", field: "ts" },
    });
  }
});
test("issue: session missing or not a string", () => {
  for (const o of [
    { ts: TS, event: "Stop" },
    { ts: TS, session: 5, event: "Stop" },
  ]) {
    expect(classifyHookLine(j(o))).toStrictEqual({
      issue: { reason: "missing-field", field: "session" },
    });
  }
});
test("issue: event missing or not a string", () => {
  for (const o of [
    { ts: TS, session: SID },
    { ts: TS, session: SID, event: ["Stop"] },
  ]) {
    expect(classifyHookLine(j(o))).toStrictEqual({
      issue: { reason: "missing-field", field: "event" },
    });
  }
});

test("MAPPED_EVENTS is the sorted list of events with a non-ignored meaning", () => {
  expect([...MAPPED_EVENTS]).toStrictEqual([
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
  ]);
});
