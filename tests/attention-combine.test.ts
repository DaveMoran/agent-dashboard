import { describe, expect, test } from "bun:test";
import {
  type AttentionRecord,
  applyHookEvent,
  combinedState,
  emptyRecord,
  isEnded,
  waitingAgents,
  waitSince,
} from "../src/agents/attention/combine";
import type { HookEvent, HookMeaning } from "../src/agents/attention/hook-line";
import type { AgentClears } from "../src/agents/transcripts/source";

const t = (s: number) => `2026-10-15T10:00:${String(s).padStart(2, "0")}.000Z`;

function ev(meaning: HookMeaning, ts: string, agentKey = ""): HookEvent {
  return {
    ts,
    sessionId: "s1",
    cwd: undefined,
    event: "X",
    type: undefined,
    agentId: agentKey === "" ? undefined : agentKey,
    meaning,
    agentKey,
  };
}

function fold(events: HookEvent[]): AttentionRecord {
  return events.reduce(applyHookEvent, emptyRecord());
}

function clears(
  main: string | undefined,
  subagents: Record<string, string | undefined> = {},
  lastTurnAt: string | undefined = main,
): AgentClears {
  return { main, subagents, lastTurnAt };
}

describe("emptyRecord", () => {
  test("has no waits, clears or times", () => {
    expect(emptyRecord()).toStrictEqual({
      waitAt: {},
      hookClearAt: {},
      endAt: undefined,
      lastHookAt: undefined,
      newestAt: undefined,
    });
  });

  test("returns a fresh object each call", () => {
    const a = emptyRecord();
    const b = emptyRecord();
    expect(a).not.toBe(b);
    expect(a.waitAt).not.toBe(b.waitAt);
    expect(a.hookClearAt).not.toBe(b.hookClearAt);
  });
});

describe("applyHookEvent", () => {
  test("wait-start sets waitAt for the agent key, plus lastHookAt and newestAt", () => {
    expect(applyHookEvent(emptyRecord(), ev("wait-start", t(5), "a1"))).toStrictEqual({
      waitAt: { a1: t(5) },
      hookClearAt: {},
      endAt: undefined,
      lastHookAt: t(5),
      newestAt: t(5),
    });
  });

  test("main agent key is the empty string", () => {
    expect(applyHookEvent(emptyRecord(), ev("wait-start", t(5))).waitAt).toStrictEqual({ "": t(5) });
  });

  test("wait-end sets hookClearAt for the agent key, plus lastHookAt and newestAt", () => {
    expect(applyHookEvent(emptyRecord(), ev("wait-end", t(6), "a1"))).toStrictEqual({
      waitAt: {},
      hookClearAt: { a1: t(6) },
      endAt: undefined,
      lastHookAt: t(6),
      newestAt: t(6),
    });
  });

  test("session-end sets endAt and newestAt but not lastHookAt", () => {
    expect(applyHookEvent(emptyRecord(), ev("session-end", t(7)))).toStrictEqual({
      waitAt: {},
      hookClearAt: {},
      endAt: t(7),
      lastHookAt: undefined,
      newestAt: t(7),
    });
  });

  test("ignored sets only lastHookAt and newestAt", () => {
    expect(applyHookEvent(emptyRecord(), ev("ignored", t(8), "a1"))).toStrictEqual({
      waitAt: {},
      hookClearAt: {},
      endAt: undefined,
      lastHookAt: t(8),
      newestAt: t(8),
    });
  });

  test("keeps the maximum per agent, whatever the order", () => {
    const r = fold([
      ev("wait-start", t(9)),
      ev("wait-start", t(3)),
      ev("wait-end", t(4), "a1"),
      ev("wait-end", t(2), "a1"),
    ]);
    expect(r.waitAt).toStrictEqual({ "": t(9) });
    expect(r.hookClearAt).toStrictEqual({ a1: t(4) });
  });

  test("keeps separate maxima for separate agents", () => {
    const r = fold([
      ev("wait-start", t(3), "a1"),
      ev("wait-start", t(4), "a2"),
      ev("wait-start", t(2), "a1"),
    ]);
    expect(r.waitAt).toStrictEqual({ a1: t(3), a2: t(4) });
  });

  test("lastHookAt and newestAt keep maxima; endAt keeps its own maximum", () => {
    const r = fold([
      ev("ignored", t(10)),
      ev("wait-end", t(4)),
      ev("session-end", t(12)),
      ev("session-end", t(11)),
      ev("wait-start", t(2)),
    ]);
    expect(r.lastHookAt).toBe(t(10));
    expect(r.endAt).toBe(t(12));
    expect(r.newestAt).toBe(t(12));
  });

  test("a session-end older than lastHookAt does not lower or change lastHookAt", () => {
    const r = fold([ev("ignored", t(10)), ev("session-end", t(3))]);
    expect(r.lastHookAt).toBe(t(10));
    expect(r.newestAt).toBe(t(10));
    expect(r.endAt).toBe(t(3));
  });

  test("does not mutate the input record", () => {
    const base = fold([ev("wait-start", t(3), "a1"), ev("wait-end", t(2), "a1")]);
    const snapshot = structuredClone(base);
    const out = applyHookEvent(base, ev("wait-start", t(9), "a1"));
    applyHookEvent(base, ev("session-end", t(9)));
    expect(base).toStrictEqual(snapshot);
    expect(out).not.toBe(base);
    expect(out.waitAt.a1).toBe(t(9));
  });

  test("same events in reversed order give a deep-equal record (FR-010)", () => {
    const events = [
      ev("wait-start", t(3)),
      ev("wait-end", t(5)),
      ev("wait-start", t(7), "a1"),
      ev("wait-end", t(6), "a1"),
      ev("ignored", t(8), "a2"),
      ev("session-end", t(9)),
      ev("wait-start", t(4)),
    ];
    expect(fold([...events].reverse())).toStrictEqual(fold(events));
  });
});

describe("waitingAgents", () => {
  test("empty record: nobody waiting", () => {
    expect(waitingAgents(emptyRecord(), undefined)).toStrictEqual([]);
    expect(waitingAgents(emptyRecord(), clears(t(1)))).toStrictEqual([]);
  });

  test("US1.1/1.2: main wait with no clears is waiting (clears undefined)", () => {
    expect(waitingAgents(fold([ev("wait-start", t(5))]), undefined)).toStrictEqual([""]);
  });

  test("undefined clear values count as never", () => {
    const r = fold([ev("wait-start", t(5)), ev("wait-start", t(5), "a1")]);
    expect(waitingAgents(r, clears(undefined, { a1: undefined }))).toStrictEqual(["", "a1"]);
  });

  test("US1.3: main wait ended by a later main transcript entry", () => {
    const r = fold([ev("wait-start", t(5))]);
    expect(waitingAgents(r, clears(t(6)))).toStrictEqual([]);
  });

  test("a main transcript entry earlier than the wait does not clear it", () => {
    const r = fold([ev("wait-start", t(5))]);
    expect(waitingAgents(r, clears(t(4)))).toStrictEqual([""]);
  });

  test("a tie with the transcript clear is not waiting", () => {
    const r = fold([ev("wait-start", t(5)), ev("wait-start", t(5), "a1")]);
    expect(waitingAgents(r, clears(t(5), { a1: t(5) }))).toStrictEqual([]);
  });

  test("a tie with the hook clear is not waiting", () => {
    const r = fold([ev("wait-start", t(5)), ev("wait-end", t(5))]);
    expect(waitingAgents(r, undefined)).toStrictEqual([]);
  });

  test("US1.4: a later hook wait-end clears the wait; an earlier one does not", () => {
    expect(waitingAgents(fold([ev("wait-start", t(5)), ev("wait-end", t(6))]), undefined)).toStrictEqual([]);
    expect(waitingAgents(fold([ev("wait-start", t(5)), ev("wait-end", t(4))]), undefined)).toStrictEqual([
      "",
    ]);
  });

  test("a new wait after a hook clear is waiting again", () => {
    const r = fold([ev("wait-start", t(5)), ev("wait-end", t(6)), ev("wait-start", t(7))]);
    expect(waitingAgents(r, undefined)).toStrictEqual([""]);
  });

  test("the later of hook clear and transcript clear governs", () => {
    const r = fold([ev("wait-start", t(5)), ev("wait-end", t(4))]);
    expect(waitingAgents(r, clears(t(6)))).toStrictEqual([]);
    const r2 = fold([ev("wait-start", t(5)), ev("wait-end", t(6))]);
    expect(waitingAgents(r2, clears(t(4)))).toStrictEqual([]);
  });

  test("US1.5: subagent wait ended by that subagent's transcript clear", () => {
    const r = fold([ev("wait-start", t(5), "a1")]);
    expect(waitingAgents(r, clears(t(1), { a1: t(6) }))).toStrictEqual([]);
    expect(waitingAgents(r, clears(t(1), { a1: t(4) }))).toStrictEqual(["a1"]);
  });

  test("subagent unknown to the clears is not cleared", () => {
    const r = fold([ev("wait-start", t(5), "a1")]);
    expect(waitingAgents(r, clears(t(9), {}))).toStrictEqual(["a1"]);
  });

  test("a main wait is not ended by a subagent clear", () => {
    const r = fold([ev("wait-start", t(5))]);
    expect(waitingAgents(r, clears(t(1), { a1: t(9) }, t(9)))).toStrictEqual([""]);
  });

  test("a main wait is not ended by a subagent hook wait-end", () => {
    const r = fold([ev("wait-start", t(5)), ev("wait-end", t(9), "a1")]);
    expect(waitingAgents(r, undefined)).toStrictEqual([""]);
  });

  test("a subagent wait is not ended by clears.main (FR-008)", () => {
    const r = fold([ev("wait-start", t(5), "a1")]);
    expect(waitingAgents(r, clears(t(9), { a1: t(1) }))).toStrictEqual(["a1"]);
  });

  test("a subagent wait is not ended by another subagent's clear or hook wait-end", () => {
    const r = fold([ev("wait-start", t(5), "a1"), ev("wait-end", t(9), "a2")]);
    expect(waitingAgents(r, clears(t(9), { a1: t(1), a2: t(9) }))).toStrictEqual(["a1"]);
  });

  test("two subagents waiting, one cleared: still waiting", () => {
    const r = fold([ev("wait-start", t(5), "a1"), ev("wait-start", t(6), "a2")]);
    expect(waitingAgents(r, clears(t(1), { a1: t(7), a2: t(1) }))).toStrictEqual(["a2"]);
  });

  test("result is sorted", () => {
    const r = fold([ev("wait-start", t(5), "b"), ev("wait-start", t(5), "a"), ev("wait-start", t(5))]);
    expect(waitingAgents(r, undefined)).toStrictEqual(["", "a", "b"]);
  });

  test("does not mutate the record", () => {
    const r = fold([ev("wait-start", t(5), "a1")]);
    const snapshot = structuredClone(r);
    waitingAgents(r, clears(t(9), { a1: t(9) }));
    expect(r).toStrictEqual(snapshot);
  });
});

describe("waitSince", () => {
  test("undefined when nobody is waiting", () => {
    expect(waitSince(emptyRecord(), undefined)).toBeUndefined();
    expect(waitSince(fold([ev("wait-start", t(5))]), clears(t(6)))).toBeUndefined();
  });

  test("US1.1: the single wait's timestamp", () => {
    expect(waitSince(fold([ev("wait-start", t(5))]), undefined)).toBe(t(5));
  });

  test("latest waitAt among waiting agents", () => {
    const r = fold([ev("wait-start", t(5)), ev("wait-start", t(8), "a1"), ev("wait-start", t(6), "a2")]);
    expect(waitSince(r, undefined)).toBe(t(8));
  });

  test("ignores agents that are no longer waiting, even with a later waitAt", () => {
    const r = fold([ev("wait-start", t(5)), ev("wait-start", t(8), "a1")]);
    expect(waitSince(r, clears(t(1), { a1: t(9) }))).toBe(t(5));
  });
});

describe("isEnded", () => {
  test("false without an end event", () => {
    expect(isEnded(emptyRecord(), undefined)).toBe(false);
    expect(isEnded(fold([ev("ignored", t(5))]), clears(t(1)))).toBe(false);
  });

  test("true when endAt is the latest and clears are undefined", () => {
    expect(isEnded(fold([ev("session-end", t(5))]), undefined)).toBe(true);
    expect(isEnded(fold([ev("session-end", t(5))]), clears(undefined, {}, undefined))).toBe(true);
  });

  test("false when a later turn exists", () => {
    const r = fold([ev("session-end", t(5))]);
    expect(isEnded(r, clears(t(6)))).toBe(false);
  });

  test("a tie with lastTurnAt is not ended", () => {
    expect(isEnded(fold([ev("session-end", t(5))]), clears(t(5)))).toBe(false);
  });

  test("an earlier turn does not stop the end", () => {
    expect(isEnded(fold([ev("session-end", t(5))]), clears(t(4)))).toBe(true);
  });

  test("uses lastTurnAt, not main", () => {
    const r = fold([ev("session-end", t(5))]);
    expect(isEnded(r, clears(t(1), { a1: t(9) }, t(9)))).toBe(false);
    expect(isEnded(r, clears(t(9), {}, t(1)))).toBe(true);
  });

  test("false when a later hook event exists", () => {
    expect(isEnded(fold([ev("session-end", t(5)), ev("ignored", t(6))]), undefined)).toBe(false);
    expect(isEnded(fold([ev("session-end", t(5)), ev("wait-start", t(6))]), undefined)).toBe(false);
  });

  test("a tie with lastHookAt is not ended", () => {
    expect(isEnded(fold([ev("session-end", t(5)), ev("wait-end", t(5))]), undefined)).toBe(false);
  });

  test("an earlier hook event does not stop the end", () => {
    expect(isEnded(fold([ev("wait-end", t(4)), ev("session-end", t(5))]), undefined)).toBe(true);
  });

  test("a later session-end ends it again", () => {
    const r = fold([ev("session-end", t(5)), ev("ignored", t(6)), ev("session-end", t(7))]);
    expect(isEnded(r, clears(t(6)))).toBe(true);
  });
});

describe("combinedState", () => {
  test("US1.1: working base with a wait becomes waiting", () => {
    expect(combinedState("working", fold([ev("wait-start", t(5))]), undefined)).toBe("waiting");
  });

  test("standby base with a wait becomes waiting (background subagent asks)", () => {
    expect(combinedState("standby", fold([ev("wait-start", t(5), "a1")]), clears(t(1)))).toBe("waiting");
  });

  test("US1.6: waiting takes precedence over working", () => {
    expect(combinedState("working", fold([ev("wait-start", t(5))]), clears(t(1), { bg: t(9) }, t(9)))).toBe(
      "waiting",
    );
  });

  test("US1.3/1.4: cleared waits give the base state back", () => {
    const r = fold([ev("wait-start", t(5))]);
    expect(combinedState("working", r, clears(t(6)))).toBe("working");
    expect(combinedState("standby", r, clears(t(6)))).toBe("standby");
    expect(combinedState("standby", fold([ev("wait-start", t(5)), ev("wait-end", t(6))]), undefined)).toBe(
      "standby",
    );
  });

  test("no record: base state unchanged", () => {
    expect(combinedState("working", emptyRecord(), undefined)).toBe("working");
    expect(combinedState("standby", emptyRecord(), clears(t(1)))).toBe("standby");
  });

  test("two waits, one cleared: still waiting", () => {
    const r = fold([ev("wait-start", t(5)), ev("wait-start", t(6), "a1")]);
    expect(combinedState("working", r, clears(t(7), { a1: t(1) }))).toBe("waiting");
    expect(combinedState("working", r, clears(t(7), { a1: t(8) }))).toBe("working");
  });
});
