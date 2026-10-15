import { expect, test } from "bun:test";
import { classifyLine } from "../src/agents/transcripts/entry";
import { applyEntry, initialSessionState, type SessionStateT } from "../src/agents/transcripts/session-state";

const j = (o: unknown) => JSON.stringify(o);
const u = (t: string, content: unknown = "go", extra: object = {}) =>
  j({ type: "user", timestamp: t, sessionId: "s1", cwd: "/r", message: { content }, ...extra });
const call = (t: string, id: string) =>
  j({ type: "assistant", timestamp: t, sessionId: "s1", message: { model: "claude-opus-5-5", stop_reason: "tool_use", content: [{ type: "tool_use", id }] } });
const result = (t: string, id: string) => u(t, [{ type: "tool_result", tool_use_id: id }]);
const final = (t: string) =>
  j({ type: "assistant", timestamp: t, message: { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] } });

function fold(lines: string[]): SessionStateT {
  let s = initialSessionState();
  for (const l of lines) {
    const r = classifyLine(l);
    if (!("entry" in r)) throw new Error("bad line " + l);
    s = applyEntry(s, r.entry);
  }
  return s;
}

const T = (n: number) => `2026-10-15T10:00:0${n}.000Z`;

test("initial state is standby and empty", () => {
  expect(initialSessionState()).toStrictEqual({
    sessionId: undefined, model: undefined, cwd: undefined, state: "standby",
    stateSince: undefined, lastActivity: undefined, openToolUseIds: [],
    completedAgentIds: {}, ended: false,
  });
});

test("scenario 1: last entry a prompt is working", () => {
  const s = fold([u(T(1))]);
  expect(s.state).toBe("working");
  expect(s.lastActivity).toBe(T(1));
  expect(s.stateSince).toBe(T(1));
  expect(s.sessionId).toBe("s1");
  expect(s.cwd).toBe("/r");
});

test("scenario 2: open tool call is working", () => {
  const s = fold([u(T(1)), call(T(2), "t1")]);
  expect(s.state).toBe("working");
  expect(s.openToolUseIds).toStrictEqual(["t1"]);
  expect(s.model).toBe("claude-opus-5-5");
});

test("scenario 3: tool result is working", () => {
  const s = fold([u(T(1)), call(T(2), "t1"), result(T(3), "t1")]);
  expect(s.state).toBe("working");
  expect(s.openToolUseIds).toStrictEqual([]);
  expect(s.stateSince).toBe(T(1));
});

test("scenario 4: final reply is standby", () => {
  const s = fold([u(T(1)), call(T(2), "t1"), result(T(3), "t1"), final(T(4))]);
  expect(s.state).toBe("standby");
  expect(s.stateSince).toBe(T(4));
  expect(s.lastActivity).toBe(T(4));
});

test("scenario 5: foreground subagent call stays working until final", () => {
  const mid = fold([u(T(1)), call(T(2), "agent1")]);
  expect(mid.state).toBe("working");
  expect(mid.openToolUseIds).toStrictEqual(["agent1"]);
  const done = fold([u(T(1)), call(T(2), "agent1"), result(T(5), "agent1"), final(T(6))]);
  expect(done.state).toBe("standby");
  expect(done.openToolUseIds).toStrictEqual([]);
});

test("scenario 8: interrupt after open call is standby and clears open ids", () => {
  const s = fold([u(T(1)), call(T(2), "t1"), u(T(3), [{ type: "text", text: "[Request interrupted by user]" }])]);
  expect(s.state).toBe("standby");
  expect(s.stateSince).toBe(T(3));
  expect(s.openToolUseIds).toStrictEqual([]);
});

test("parallel tool calls: one result leaves one open and still working", () => {
  const s = fold([u(T(1)), call(T(2), "a"), call(T(3), "b"), result(T(4), "a")]);
  expect(s.state).toBe("working");
  expect(s.openToolUseIds).toStrictEqual(["b"]);
});

test("other entries update lastActivity but not state", () => {
  const s = fold([u(T(1)), j({ type: "file-history-snapshot", timestamp: T(5) })]);
  expect(s.state).toBe("working");
  expect(s.lastActivity).toBe(T(5));
  expect(s.stateSince).toBe(T(1));
  const only = fold([j({ type: "file-history-snapshot", timestamp: T(5) })]);
  expect(only.state).toBe("standby");
  expect(only.lastActivity).toBe(T(5));
});

test("an older timestamp does not move lastActivity back", () => {
  const s = fold([u(T(5)), call(T(2), "t1")]);
  expect(s.lastActivity).toBe(T(5));
});

test("stateSince changes only on state change", () => {
  const s = fold([u(T(1)), call(T(2), "t1"), result(T(3), "t1")]);
  expect(s.stateSince).toBe(T(1));
});

test("task notification records completed agents with the entry timestamp", () => {
  const n = "<task-notification>\n<task-id>ag1</task-id>\n<status>completed</status>\n</task-notification>";
  const s = fold([final(T(1)), u(T(4), n)]);
  expect(s.completedAgentIds).toStrictEqual({ ag1: T(4) });
  expect(s.state).toBe("working");
});

function deepFreeze<T>(o: T): T {
  if (typeof o === "object" && o !== null) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

test("applyEntry does not mutate its input", () => {
  let s = fold([u(T(1)), call(T(2), "t1")]);
  s = applyEntry(s, { ...(classifyLine(u(T(0))) as any).entry });
  const frozen = deepFreeze(s);
  const before = JSON.stringify(frozen);
  const notif = "<task-notification><task-id>x</task-id><status>c</status></task-notification>";
  for (const l of [result(T(3), "t1"), call(T(4), "t2"), final(T(5)), u(T(6), notif)]) {
    const r = classifyLine(l) as any;
    const out = applyEntry(frozen, r.entry);
    expect(out).not.toBe(frozen);
  }
  expect(JSON.stringify(frozen)).toBe(before);
});

const sessionEnd = (t: string) => j({ type: "continued-in", timestamp: t, sessionId: "s1", continuedInSessionId: "s2" });
const queuedNote = (t: string, id: string) =>
  j({ type: "attachment", timestamp: t, sessionId: "s1", attachment: { type: "queued_command", prompt: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>` } });

test("session-end after a prompt gives standby and ended; a later prompt resumes", () => {
  const s = fold([u(T(1)), call(T(2), "x"), sessionEnd(T(3))]);
  expect(s.state).toBe("standby");
  expect(s.stateSince).toBe(T(3));
  expect(s.ended).toBe(true);
  expect(s.openToolUseIds).toEqual([]);
  const r = applyEntry(s, (classifyLine(u(T(4))) as any).entry);
  expect(r.state).toBe("working");
  expect(r.ended).toBe(false);
});

test("a queued notification records the agent id without changing state", () => {
  const s = fold([u(T(1)), queuedNote(T(2), "a1")]);
  expect(s.state).toBe("working");
  expect(s.stateSince).toBe(T(1));
  expect(s.completedAgentIds).toEqual({ a1: T(2) });
});
