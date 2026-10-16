import { expect, test } from "bun:test";
import { classifyLine } from "../src/agents/transcripts/entry";
import { applyEntry, initialSessionState, type SessionStateT } from "../src/agents/transcripts/session-state";
import { combineState, isSubagentRunning } from "../src/agents/transcripts/subagents";

const j = (o: unknown) => JSON.stringify(o);
const u = (t: string, content: unknown = "go") => j({ type: "user", timestamp: t, message: { content } });
const call = (t: string, id: string) =>
  j({
    type: "assistant",
    timestamp: t,
    message: { stop_reason: "tool_use", content: [{ type: "tool_use", id }] },
  });
const result = (t: string, id: string) => u(t, [{ type: "tool_result", tool_use_id: id }]);
const final = (t: string) =>
  j({ type: "assistant", timestamp: t, message: { stop_reason: "end_turn", content: [] } });
const turnEnd = (t: string) => j({ type: "system", subtype: "turn_duration", timestamp: t });
const notif = (t: string, id: string) =>
  u(t, `<task-notification>\n<task-id>${id}</task-id>\n<status>killed</status>\n</task-notification>`);
const T = (n: number) => `2026-10-15T10:0${n}:00.000Z`;

function fold(lines: string[]): SessionStateT {
  let s = initialSessionState();
  for (const l of lines) s = applyEntry(s, (classifyLine(l) as any).entry);
  return s;
}

const parentNoNotice = fold([final(T(1))]);

test("a working subagent with no notification is running", () => {
  expect(isSubagentRunning("a", fold([u(T(2))]), parentNoNotice)).toBe(true);
});

test("a subagent ending in final is not running", () => {
  expect(isSubagentRunning("a", fold([u(T(2)), final(T(3))]), parentNoNotice)).toBe(false);
});

test("a working subagent named in a parent notification is not running (scenario 7)", () => {
  const parent = fold([final(T(1)), notif(T(5), "a")]);
  expect(isSubagentRunning("a", fold([u(T(2)), call(T(3), "x")]), parent)).toBe(false);
});

test("a subagent with an entry newer than its notification is running again", () => {
  const parent = fold([final(T(1)), notif(T(5), "a")]);
  expect(isSubagentRunning("a", fold([u(T(2)), u(T(6))]), parent)).toBe(true);
  expect(isSubagentRunning("b", fold([u(T(2))]), parent)).toBe(true);
});

test("combineState truth table", () => {
  expect(combineState("working", 0)).toBe("working");
  expect(combineState("working", 2)).toBe("working");
  expect(combineState("standby", 1)).toBe("working");
  expect(combineState("standby", 0)).toBe("standby");
});

test("scenario 6 in memory", () => {
  const parent = fold([
    u(T(1)),
    call(T(2), "c1"),
    call(T(2), "c2"),
    call(T(2), "c3"),
    result(T(3), "c1"),
    result(T(3), "c2"),
    result(T(3), "c3"),
    final(T(4)),
    turnEnd(T(4)),
    notif(T(8), "b"),
    final(T(8)),
    turnEnd(T(8)),
  ]);
  expect(parent.state).toBe("standby");
  const subs: Record<string, SessionStateT> = {
    a: fold([u(T(1)), final(T(5))]),
    b: fold([u(T(1)), call(T(2), "z")]),
    c: fold([u(T(1)), call(T(6), "z")]),
  };
  const running = () => Object.entries(subs).filter(([id, s]) => isSubagentRunning(id, s, parent)).length;
  expect(running()).toBe(1);
  expect(combineState(parent.state, running())).toBe("working");
  subs["c"] = applyEntry(subs["c"]!, (classifyLine(final(T(9))) as any).entry);
  expect(running()).toBe(0);
  expect(combineState(parent.state, running())).toBe("standby");
});

test("a working subagent of an ended parent is not running", () => {
  const ended = fold([u(T(1)), j({ type: "continued-in", timestamp: T(2) })]);
  expect(isSubagentRunning("a", fold([u(T(1)), call(T(2), "x")]), ended)).toBe(false);
});
