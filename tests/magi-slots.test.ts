import { describe, expect, test } from "bun:test";
import type { AgentSession } from "../src/agents/source";
import type { BrainState, BrainView } from "../src/contract/magi";
import {
  BRAIN_NAMES,
  emptySlotState,
  isLive,
  projectPath,
  type SlotOptions,
  type SlotState,
  stepSlots,
} from "../src/magi/slots";
import { makeSession } from "./stub-agent-source";

// Times are written "10:30" and fall on 2026-10-18.
// Accepts "10:30", "10:30:00" or "10:30:00.001".
export const ms = (time: string): number => {
  const full = time.length === 5 ? `${time}:00.000` : time.includes(".") ? time : `${time}.000`;
  return Date.parse(`2026-10-18T${full}Z`);
};
export const iso = (hhmm: string): string => new Date(ms(hhmm)).toISOString();

export const OPTIONS: SlotOptions = { idleMs: 30 * 60_000, waitingMs: 240 * 60_000 };
const MIN = 60_000;

/** A main session in project `p` (id `/p/.git`, name `p`). */
export function sess(p: string, last: string, extra: Partial<AgentSession> = {}): AgentSession {
  return makeSession({
    sessionId: `s-${p}`,
    projectId: `/${p}/.git`,
    projectName: p,
    cwd: `/${p}`,
    lastActivity: iso(last),
    ...extra,
  });
}

/** Brains with `stateSince` left out (T004 does not pin it). */
export function view(state: SlotState): Array<Omit<BrainView, "stateSince">> {
  return state.brains.map(({ stateSince: _s, ...rest }) => rest);
}

export function free(number: 1 | 2 | 3): Omit<BrainView, "stateSince"> {
  return { number, name: BRAIN_NAMES[number - 1], state: "not-active", project: null };
}

export function held(
  number: 1 | 2 | 3,
  p: string,
  state: BrainState,
  name = p,
): Omit<BrainView, "stateSince"> {
  return {
    number,
    name: BRAIN_NAMES[number - 1],
    state,
    project: { id: `/${p}/.git`, name, path: `/${p}` },
  };
}

export function step(prev: SlotState, sessions: AgentSession[], now: string): SlotState {
  return stepSlots(prev, sessions, ms(now), OPTIONS);
}

describe("slot core", () => {
  test("BRAIN_NAMES", () => {
    expect([...BRAIN_NAMES]).toStrictEqual(["MELCHIOR", "BALTHASAR", "CASPER"]);
  });

  test("emptySlotState", () => {
    const s = emptySlotState();
    expect(s.brains).toStrictEqual([
      { number: 1, name: "MELCHIOR", state: "not-active", stateSince: null, project: null },
      { number: 2, name: "BALTHASAR", state: "not-active", stateSince: null, project: null },
      { number: 3, name: "CASPER", state: "not-active", stateSince: null, project: null },
    ]);
    expect(s.prevLive).toStrictEqual(new Map());
    expect(s.started).toBe(false);
  });

  test("projectPath", () => {
    expect(projectPath("/x/repo/.git")).toBe("/x/repo");
    expect(projectPath("/x/plain")).toBe("/x/plain");
    expect(projectPath("/x/bare.git")).toBe("/x/bare.git");
  });
});

describe("isLive", () => {
  const now = ms("10:30");
  const at = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  test("standby is live at exactly 30 min and not at 30 min + 1 ms", () => {
    expect(isLive(makeSession({ state: "standby", lastActivity: at(30 * MIN) }), now, OPTIONS)).toBe(true);
    expect(isLive(makeSession({ state: "standby", lastActivity: at(30 * MIN + 1) }), now, OPTIONS)).toBe(
      false,
    );
  });

  test("working follows the idle rule", () => {
    expect(isLive(makeSession({ state: "working", lastActivity: at(30 * MIN) }), now, OPTIONS)).toBe(true);
    expect(isLive(makeSession({ state: "working", lastActivity: at(30 * MIN + 1) }), now, OPTIONS)).toBe(
      false,
    );
  });

  test("waiting is live at 3 h and not at 4 h + 1 ms", () => {
    expect(isLive(makeSession({ state: "waiting", lastActivity: at(180 * MIN) }), now, OPTIONS)).toBe(true);
    expect(isLive(makeSession({ state: "waiting", lastActivity: at(240 * MIN) }), now, OPTIONS)).toBe(true);
    expect(isLive(makeSession({ state: "waiting", lastActivity: at(240 * MIN + 1) }), now, OPTIONS)).toBe(
      false,
    );
  });

  test("a non-main session is never live", () => {
    expect(isLive(makeSession({ isMain: false, lastActivity: at(0) }), now, OPTIONS)).toBe(false);
  });

  test("missing or unparsable lastActivity is never live", () => {
    expect(isLive(makeSession({ lastActivity: undefined }), now, OPTIONS)).toBe(false);
    expect(isLive(makeSession({ lastActivity: "nope" }), now, OPTIONS)).toBe(false);
  });

  test("a future lastActivity is live", () => {
    expect(isLive(makeSession({ lastActivity: iso("10:40") }), now, OPTIONS)).toBe(true);
  });
});

describe("US1 assignment", () => {
  test("empty sessions keep three not-active brains", () => {
    const next = step(emptySlotState(), [], "10:30");
    expect(view(next)).toStrictEqual([free(1), free(2), free(3)]);
    expect(next.started).toBe(true);
    expect(next.prevLive).toStrictEqual(new Map());
  });

  test("one live session takes MELCHIOR (US1-1)", () => {
    const next = step(emptySlotState(), [sess("a", "10:25")], "10:30");
    expect(view(next)).toStrictEqual([held(1, "a", "standby"), free(2), free(3)]);
    expect(next.brains[0]?.project).toStrictEqual({ id: "/a/.git", name: "a", path: "/a" });
    expect(next.prevLive).toStrictEqual(new Map([["s-a", "/a/.git"]]));
    expect(next.started).toBe(true);
  });

  test("projects arriving one by one take brains 1, 2, 3 (US1-2)", () => {
    const a = sess("a", "10:01");
    const b = sess("b", "10:02");
    const c = sess("c", "10:03");
    const s1 = step(emptySlotState(), [a], "10:04");
    const s2 = step(s1, [a, b], "10:04");
    const s3 = step(s2, [a, b, c], "10:04");
    expect(view(s1)).toStrictEqual([held(1, "a", "standby"), free(2), free(3)]);
    expect(view(s2)).toStrictEqual([held(1, "a", "standby"), held(2, "b", "standby"), free(3)]);
    expect(view(s3)).toStrictEqual([
      held(1, "a", "standby"),
      held(2, "b", "standby"),
      held(3, "c", "standby"),
    ]);
  });

  test("a freed brain does not shift others; a new project takes the free one (US1-3, US1-4)", () => {
    const a = sess("a", "10:01");
    const b = sess("b", "10:02");
    const s1 = step(step(emptySlotState(), [a], "10:03"), [a, b], "10:03");
    expect(view(s1)).toStrictEqual([held(1, "a", "standby"), held(2, "b", "standby"), free(3)]);
    const s2 = step(s1, [b], "10:04");
    expect(view(s2)).toStrictEqual([free(1), held(2, "b", "standby"), free(3)]);
    const d = sess("d", "10:05");
    const s3 = step(s2, [b, d], "10:06");
    expect(view(s3)).toStrictEqual([held(1, "d", "standby"), held(2, "b", "standby"), free(3)]);
  });

  test("a second live session in the same project keeps its brain (US1-5)", () => {
    const a1 = sess("a", "10:01");
    const a2 = sess("a", "10:05", { sessionId: "s-a2", cwd: "/a-wt" });
    const s1 = step(emptySlotState(), [a1], "10:06");
    const s2 = step(s1, [a1, a2], "10:06");
    expect(view(s2)).toStrictEqual([held(1, "a", "standby"), free(2), free(3)]);
    expect(s2.prevLive).toStrictEqual(
      new Map([
        ["s-a", "/a/.git"],
        ["s-a2", "/a/.git"],
      ]),
    );
  });

  test("a project with only non-main sessions takes no brain (US1-6)", () => {
    const sub = sess("a", "10:25", { isMain: false });
    const next = step(emptySlotState(), [sub], "10:30");
    expect(view(next)).toStrictEqual([free(1), free(2), free(3)]);
    expect(next.prevLive).toStrictEqual(new Map());
  });

  test("a session that left sessions() frees its brain at the next step (US2-1)", () => {
    const a = sess("a", "10:25");
    const s1 = step(emptySlotState(), [a], "10:30");
    expect(view(s1)[0]).toStrictEqual(held(1, "a", "standby"));
    const s2 = step(s1, [], "10:30");
    expect(view(s2)).toStrictEqual([free(1), free(2), free(3)]);
  });

  test("a kept brain follows a renamed project", () => {
    const s1 = step(emptySlotState(), [sess("a", "10:20")], "10:30");
    const renamed = sess("a", "10:25", { projectName: "alpha" });
    const s2 = step(s1, [renamed], "10:30");
    expect(view(s2)[0]).toStrictEqual(held(1, "a", "standby", "alpha"));
  });

  test("project name comes from the session with the latest lastActivity", () => {
    const old = sess("a", "10:10", { projectName: "old" });
    const recent = sess("a", "10:20", { sessionId: "s-a2", projectName: "recent" });
    const next = step(emptySlotState(), [old, recent], "10:30");
    expect(view(next)[0]).toStrictEqual(held(1, "a", "standby", "recent"));
    const flipped = step(emptySlotState(), [recent, old], "10:30");
    expect(view(flipped)[0]).toStrictEqual(held(1, "a", "standby", "recent"));
  });

  test("a project outside git uses its id as the path", () => {
    const s = makeSession({
      sessionId: "s-plain",
      projectId: "/x/plain",
      projectName: "plain",
      cwd: "/x/plain",
      lastActivity: iso("10:25"),
    });
    const next = step(emptySlotState(), [s], "10:30");
    expect(next.brains[0]?.project).toStrictEqual({ id: "/x/plain", name: "plain", path: "/x/plain" });
  });

  test("stale sessions are ignored for assignment", () => {
    const stale = sess("a", "09:59");
    const next = step(emptySlotState(), [stale], "10:30");
    expect(view(next)).toStrictEqual([free(1), free(2), free(3)]);
    expect(next.prevLive).toStrictEqual(new Map());
  });
});

describe("US3 project state", () => {
  const two = (s1: AgentSession["state"], s2: AgentSession["state"]) => [
    sess("a", "10:20", { state: s1 }),
    sess("a", "10:21", { sessionId: "s-a2", state: s2 }),
  ];

  test("standby + working gives working", () => {
    expect(view(step(emptySlotState(), two("standby", "working"), "10:30"))[0]).toStrictEqual(
      held(1, "a", "working"),
    );
  });

  test("working + waiting gives waiting", () => {
    expect(view(step(emptySlotState(), two("working", "waiting"), "10:30"))[0]).toStrictEqual(
      held(1, "a", "waiting"),
    );
  });

  test("standby + standby gives standby", () => {
    expect(view(step(emptySlotState(), two("standby", "standby"), "10:30"))[0]).toStrictEqual(
      held(1, "a", "standby"),
    );
  });

  test("a kept brain updates its state", () => {
    const s1 = step(emptySlotState(), [sess("a", "10:20", { state: "standby" })], "10:30");
    const s2 = step(s1, [sess("a", "10:30", { state: "working" })], "10:30");
    expect(view(s2)[0]).toStrictEqual(held(1, "a", "working"));
  });
});

describe("purity", () => {
  test("does not mutate prev and is deterministic", () => {
    const a = sess("a", "10:01");
    const b = sess("b", "10:02");
    const prev = step(emptySlotState(), [a], "10:03");
    const snapshot = structuredClone(prev);
    const out1 = step(prev, [a, b], "10:04");
    expect(prev).toStrictEqual(snapshot);
    expect(prev.brains).not.toBe(out1.brains);
    expect(prev.brains[0]).not.toBe(out1.brains[0]);
    const out2 = step(prev, [a, b], "10:04");
    expect(out2).toStrictEqual(out1);
  });
});

describe("US2 timeouts", () => {
  const threeFree = [free(1), free(2), free(3)];

  test("standby holds at exactly 30 min and frees 1 ms later (US2-2)", () => {
    const a = sess("a", "10:00", { state: "standby" });
    const s1 = step(emptySlotState(), [a], "10:00");
    expect(view(step(s1, [a], "10:30"))[0]).toStrictEqual(held(1, "a", "standby"));
    expect(view(step(s1, [a], "10:30:00.001"))).toStrictEqual(threeFree);
  });

  test("a project keeps its brain while another session of it ends (US2-3)", () => {
    const x = sess("a", "10:20", { sessionId: "x", state: "standby" });
    const y = sess("a", "10:25", { sessionId: "y", state: "standby" });
    const s1 = step(emptySlotState(), [x, y], "10:26");
    const s2 = step(s1, [y], "10:27");
    expect(view(s2)).toStrictEqual([held(1, "a", "standby"), free(2), free(3)]);
  });

  test("a stale working session frees the brain (US2-4)", () => {
    const a = sess("a", "10:00", { state: "working" });
    const s1 = step(emptySlotState(), [a], "10:00");
    expect(view(step(s1, [a], "10:30"))[0]).toStrictEqual(held(1, "a", "working"));
    expect(view(step(s1, [a], "10:31"))).toStrictEqual(threeFree);
  });

  test("a timed-out working session does not count toward project state (US2-5)", () => {
    const x = sess("a", "09:00", { sessionId: "x", state: "working" });
    const y = sess("a", "10:20", { sessionId: "y", state: "standby" });
    const out = step(emptySlotState(), [x, y], "10:30");
    expect(view(out)).toStrictEqual([held(1, "a", "standby"), free(2), free(3)]);
  });

  test("a freed project with new activity takes the lowest free brain again (US2-6)", () => {
    const a0 = sess("a", "10:00");
    const b0 = sess("b", "10:00");
    const s1 = step(emptySlotState(), [a0, b0], "10:00");
    expect(view(s1)).toStrictEqual([held(1, "a", "standby"), held(2, "b", "standby"), free(3)]);
    const b1 = sess("b", "10:30");
    const s2 = step(s1, [a0, b1], "10:31");
    expect(view(s2)).toStrictEqual([free(1), held(2, "b", "standby"), free(3)]);
    const a1 = sess("a", "11:00");
    const s3 = step(s2, [a1, b1], "11:00");
    expect(view(s3)).toStrictEqual([held(1, "a", "standby"), held(2, "b", "standby"), free(3)]);
  });

  test("a freed project takes CASPER when another project took MELCHIOR first (US2-6)", () => {
    const a0 = sess("a", "10:00");
    const b0 = sess("b", "10:00");
    const s1 = step(emptySlotState(), [a0, b0], "10:00");
    const b1 = sess("b", "10:30");
    const s2 = step(s1, [a0, b1], "10:31");
    const c = sess("c", "10:40");
    const s3 = step(s2, [a0, b1, c], "10:40");
    expect(view(s3)).toStrictEqual([held(1, "c", "standby"), held(2, "b", "standby"), free(3)]);
    const a1 = sess("a", "11:00");
    const c1 = sess("c", "10:50");
    const s4 = step(s3, [a1, b1, c1], "11:00");
    expect(view(s4)).toStrictEqual([
      held(1, "c", "standby"),
      held(2, "b", "standby"),
      held(3, "a", "standby"),
    ]);
  });

  test("idleMs is configurable (US2-7)", () => {
    const options: SlotOptions = { idleMs: 10 * MIN, waitingMs: 240 * MIN };
    const a = sess("a", "10:00", { state: "standby" });
    const s1 = stepSlots(emptySlotState(), [a], ms("10:00"), options);
    expect(view(stepSlots(s1, [a], ms("10:10"), options))[0]).toStrictEqual(held(1, "a", "standby"));
    expect(view(stepSlots(s1, [a], ms("10:11"), options))).toStrictEqual(threeFree);
  });

  test("a waiting session holds for 4 h and frees 1 ms later (US2-8, US2-9)", () => {
    const a = sess("a", "10:00", { state: "waiting" });
    const s1 = step(emptySlotState(), [a], "10:00");
    expect(view(step(s1, [a], "10:45"))[0]).toStrictEqual(held(1, "a", "waiting"));
    expect(view(step(s1, [a], "14:00"))[0]).toStrictEqual(held(1, "a", "waiting"));
    expect(view(step(s1, [a], "14:00:00.001"))).toStrictEqual(threeFree);
  });

  test("an answered waiting session falls back to the idle timeout", () => {
    const waiting = sess("a", "10:00", { state: "waiting" });
    const s1 = step(emptySlotState(), [waiting], "10:00");
    const answered = sess("a", "10:50", { state: "working" });
    const s2 = step(s1, [answered], "10:50");
    expect(view(s2)[0]).toStrictEqual(held(1, "a", "working"));
    expect(view(step(s2, [answered], "11:20"))[0]).toStrictEqual(held(1, "a", "working"));
    expect(view(step(s2, [answered], "11:20:00.001"))).toStrictEqual(threeFree);
  });
});
