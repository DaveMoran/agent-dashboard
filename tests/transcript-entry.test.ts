import { expect, test } from "bun:test";
import { classifyLine, type TranscriptEntry } from "../src/agents/transcripts/entry";

const T = "2026-10-15T10:00:00.000Z";
const j = (o: unknown) => JSON.stringify(o);
const entry = (line: string): TranscriptEntry => {
  const r = classifyLine(line);
  if (!("entry" in r)) throw new Error(`expected entry, got ${JSON.stringify(r)}`);
  return r.entry;
};
const user = (content: unknown, extra: object = {}) =>
  j({ type: "user", timestamp: T, message: { role: "user", content }, ...extra });
const asst = (message: object, extra: object = {}) =>
  j({ type: "assistant", timestamp: T, message, ...extra });

test("rule 1: invalid JSON", () => {
  expect(classifyLine("{nope")).toStrictEqual({ issue: { reason: "invalid-json" } });
});
test("rule 2: not an object", () => {
  for (const l of ["[1]", "null", "3", '"s"']) {
    expect(classifyLine(l)).toStrictEqual({ issue: { reason: "not-an-object" } });
  }
});
test("rule 3: type not a string", () => {
  expect(classifyLine("{}")).toStrictEqual({ issue: { reason: "missing-field", field: "type" } });
  expect(classifyLine(j({ type: 3 }))).toStrictEqual({ issue: { reason: "missing-field", field: "type" } });
});
test("rule 4: user without timestamp", () => {
  expect(classifyLine(j({ type: "user", message: { content: "hi" } }))).toStrictEqual({
    issue: { reason: "missing-field", field: "timestamp" },
  });
});
test("rule 5: isMeta is other", () => {
  expect(entry(user("hello", { isMeta: true })).kind).toBe("other");
});
test("rule 6: tool results", () => {
  const e = entry(
    user([
      { type: "tool_result", tool_use_id: "a" },
      { type: "tool_result", tool_use_id: "b" },
      { type: "text", text: "x" },
    ]),
  );
  expect(e.kind).toBe("tool-result");
  expect(e.toolUseIds).toStrictEqual(["a", "b"]);
});
test("rule 7: interrupt (string and text block)", () => {
  expect(entry(user("[Request interrupted by user for tool use]")).kind).toBe("interrupt");
  expect(entry(user([{ type: "text", text: "[Request interrupted by user]" }])).kind).toBe("interrupt");
});
test("rule 7: task notification is a prompt with completed ids only when status present", () => {
  const withStatus =
    "<task-notification>\n<task-id>a1</task-id>\n<task-id>b2</task-id>\n<status>completed</status>\n</task-notification>";
  const e = entry(user(withStatus));
  expect(e.kind).toBe("prompt");
  expect(e.completedAgentIds).toStrictEqual(["a1", "b2"]);
  const noStatus = entry(user("<task-notification>\n<task-id>a1</task-id>\n</task-notification>"));
  expect(noStatus.kind).toBe("prompt");
  expect(noStatus.completedAgentIds).toStrictEqual([]);
});
test("rule 7: command and bash wrappers are other", () => {
  for (const t of [
    "<command-name>/x</command-name>",
    "<local-command-stdout>x",
    "<bash-input>ls",
    "<bash-stdout>x",
    "<bash-stderr>x",
  ]) {
    expect(entry(user(t)).kind).toBe("other");
  }
});
test("rule 8: prompts", () => {
  expect(entry(user("hi")).kind).toBe("prompt");
  expect(entry(user([{ type: "text", text: "hi" }])).kind).toBe("prompt");
  expect(entry(user([{ type: "image" }])).kind).toBe("prompt");
});
test("rule 9: other user content", () => {
  expect(entry(user("")).kind).toBe("other");
  expect(entry(user([{ type: "thinking" }])).kind).toBe("other");
  expect(entry(j({ type: "user", timestamp: T })).kind).toBe("other");
});
test("rule 10: assistant without timestamp", () => {
  expect(classifyLine(j({ type: "assistant", message: {} }))).toStrictEqual({
    issue: { reason: "missing-field", field: "timestamp" },
  });
});
test("rule 11: model extraction", () => {
  expect(entry(asst({ model: "claude-opus-5-5", stop_reason: "end_turn" })).model).toBe("claude-opus-5-5");
  expect(entry(asst({ model: "", stop_reason: "end_turn" })).model).toBeUndefined();
  expect(entry(asst({ model: "<synthetic>", stop_reason: "stop_sequence" })).model).toBeUndefined();
  expect(entry(user("hi", { message: { model: "m", content: "hi" } })).model).toBeUndefined();
});
test("rule 12: tool call", () => {
  const e = entry(
    asst({
      model: "m",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "x" },
        { type: "tool_use", id: "t1" },
        { type: "tool_use", id: "t2" },
      ],
    }),
  );
  expect(e.kind).toBe("tool-call");
  expect(e.toolUseIds).toStrictEqual(["t1", "t2"]);
  expect(e.model).toBe("m");
});
test("rule 13: progress", () => {
  expect(entry(asst({ stop_reason: null, content: [] })).kind).toBe("progress");
  expect(entry(asst({ content: [] })).kind).toBe("progress");
  expect(entry(asst({ stop_reason: "tool_use", content: [{ type: "thinking" }] })).kind).toBe("progress");
});
test("rule 14: final", () => {
  for (const s of ["end_turn", "stop_sequence", "max_tokens", "refusal"]) {
    expect(entry(asst({ stop_reason: s, content: [] })).kind).toBe("final");
  }
});
test("rule 15: turn end", () => {
  expect(entry(j({ type: "system", subtype: "turn_duration", timestamp: T })).kind).toBe("turn-end");
});
test("rule 16: other system", () => {
  expect(entry(j({ type: "system", subtype: "other", timestamp: T })).kind).toBe("other");
  expect(entry(j({ type: "system", subtype: "turn_duration" })).kind).toBe("other");
});
test("rule 17: unknown type", () => {
  expect(entry(j({ type: "file-history-snapshot", timestamp: T })).kind).toBe("other");
});

test("the 11 contract examples classify in order", () => {
  const R = "/repo";
  const base = { sessionId: "s1", cwd: R };
  const lines = [
    j({
      type: "user",
      timestamp: "2026-10-15T10:00:00.000Z",
      ...base,
      message: { role: "user", content: "Add a test" },
    }),
    j({
      type: "assistant",
      timestamp: "2026-10-15T10:00:02.000Z",
      ...base,
      message: {
        id: "m1",
        model: "claude-opus-5-5",
        stop_reason: "tool_use",
        content: [{ type: "thinking", thinking: "" }],
      },
    }),
    j({
      type: "assistant",
      timestamp: "2026-10-15T10:00:02.100Z",
      ...base,
      message: {
        id: "m1",
        model: "claude-opus-5-5",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu1", name: "Agent", input: {} }],
      },
    }),
    j({
      type: "user",
      timestamp: "2026-10-15T10:03:00.000Z",
      ...base,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "done" }] },
    }),
    j({
      type: "assistant",
      timestamp: "2026-10-15T10:03:05.000Z",
      ...base,
      message: {
        id: "m2",
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Done." }],
      },
    }),
    j({ type: "system", subtype: "turn_duration", timestamp: "2026-10-15T10:03:05.100Z", ...base }),
    j({
      type: "user",
      timestamp: "2026-10-15T10:05:00.000Z",
      ...base,
      message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] },
    }),
    j({
      type: "user",
      timestamp: "2026-10-15T10:06:00.000Z",
      ...base,
      isMeta: true,
      message: { role: "user", content: "<local-command-caveat>…" },
    }),
    j({
      type: "user",
      timestamp: "2026-10-15T10:06:00.100Z",
      ...base,
      message: { role: "user", content: "<command-name>/model</command-name>" },
    }),
    j({ type: "file-history-snapshot", timestamp: "2026-10-15T10:06:01.000Z" }),
    j({
      type: "user",
      timestamp: "2026-10-15T10:07:00.000Z",
      ...base,
      message: {
        role: "user",
        content:
          "<task-notification>\n<task-id>a0b1c2d3e4f5a6b7c</task-id>\n<tool-use-id>tu9</tool-use-id>\n<status>completed</status>\n</task-notification>",
      },
    }),
  ];
  const es = lines.map(entry);
  expect(es.map((e) => e.kind)).toStrictEqual([
    "prompt",
    "progress",
    "tool-call",
    "tool-result",
    "final",
    "turn-end",
    "interrupt",
    "other",
    "other",
    "other",
    "prompt",
  ]);
  expect(es[2]!.toolUseIds).toStrictEqual(["tu1"]);
  expect(es[3]!.toolUseIds).toStrictEqual(["tu1"]);
  expect(es[10]!.completedAgentIds).toStrictEqual(["a0b1c2d3e4f5a6b7c"]);
  expect(es[0]!.timestamp).toBe("2026-10-15T10:00:00.000Z");
  expect(es[0]!.sessionId).toBe("s1");
  expect(es[0]!.cwd).toBe(R);
  expect(es[1]!.model).toBe("claude-opus-5-5");
  expect(es[9]!.sessionId).toBeUndefined();
});

test("synthetic final has no model", () => {
  const e = entry(
    asst({ model: "<synthetic>", stop_reason: "stop_sequence", content: [{ type: "text", text: "err" }] }),
  );
  expect(e.kind).toBe("final");
  expect(e.model).toBeUndefined();
});
test("rule 12 wins over 13", () => {
  expect(entry(asst({ stop_reason: null, content: [{ type: "tool_use", id: "x" }] })).kind).toBe("tool-call");
});
test("rule 5 wins over interrupt text", () => {
  expect(entry(user([{ type: "text", text: "[Request interrupted by user]" }], { isMeta: true })).kind).toBe(
    "other",
  );
});
test("entry has exactly the TranscriptEntry keys", () => {
  expect(Object.keys(entry(user("hi"))).sort()).toStrictEqual([
    "completedAgentIds",
    "cwd",
    "kind",
    "model",
    "sessionId",
    "timestamp",
    "toolUseIds",
  ]);
});

const queued = (prompt: unknown) =>
  j({
    type: "attachment",
    timestamp: T,
    sessionId: "s1",
    attachment: { type: "queued_command", commandMode: "task-notification", prompt },
  });
test("rule 17a: queued task notification is other with completed agent ids", () => {
  const e = entry(
    queued(
      "<task-notification>\n<task-id>a1111111111111111</task-id>\n<status>completed</status>\n</task-notification>",
    ),
  );
  expect(e.kind).toBe("other");
  expect(e.completedAgentIds).toStrictEqual(["a1111111111111111"]);
});
test("rule 17a: ordinary queued prompt and notification without status give no ids", () => {
  const a = entry(queued("hello"));
  expect(a.kind).toBe("other");
  expect(a.completedAgentIds).toStrictEqual([]);
  const b = entry(queued("<task-notification>\n<task-id>a1111111111111111</task-id>\n</task-notification>"));
  expect(b.kind).toBe("other");
  expect(b.completedAgentIds).toStrictEqual([]);
});
test("rule 17c: continued-in with timestamp is session-end, without is other", () => {
  expect(
    entry(
      j({
        type: "continued-in",
        timestamp: "2026-10-15T10:09:00.000Z",
        sessionId: "s1",
        continuedInSessionId: "s2",
      }),
    ).kind,
  ).toBe("session-end");
  expect(entry(j({ type: "continued-in", sessionId: "s1" })).kind).toBe("other");
});
