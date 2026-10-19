import { afterEach, describe, expect, test } from "bun:test";
import type { AgentSession } from "../src/agents/source";
import { createMagiService, type MagiService } from "../src/magi/service";
import { createStubAgentSource, makeSession } from "./stub-agent-source";

const ms = (time: string): number => Date.parse(`2026-10-18T${time}:00.000Z`);
const iso = (time: string): string => new Date(ms(time)).toISOString();
const IDLE = 30 * 60_000;
const WAITING = 240 * 60_000;

function sess(p: string, last: string): AgentSession {
  return makeSession({
    sessionId: `s-${p}`,
    projectId: `/${p}/.git`,
    projectName: p,
    cwd: `/${p}`,
    lastActivity: iso(last),
  });
}

const created: MagiService[] = [];
function track(service: MagiService): MagiService {
  created.push(service);
  return service;
}

afterEach(() => {
  for (const s of created.splice(0)) s.stop();
});

describe("magi service", () => {
  test("before start() brains() is three not-active brains in order", () => {
    const source = createStubAgentSource([sess("a", "10:30")]);
    const service = track(
      createMagiService({ source, idleMs: IDLE, waitingMs: WAITING, now: () => ms("10:30") }),
    );
    expect(service.brains()).toStrictEqual([
      { number: 1, name: "MELCHIOR", state: "not-active", stateSince: null, project: null },
      { number: 2, name: "BALTHASAR", state: "not-active", stateSince: null, project: null },
      { number: 3, name: "CASPER", state: "not-active", stateSince: null, project: null },
    ]);
  });

  test("start() runs one step: MELCHIOR holds the live session's project", () => {
    const source = createStubAgentSource([sess("a", "10:30")]);
    const service = track(
      createMagiService({ source, idleMs: IDLE, waitingMs: WAITING, now: () => ms("10:30"), tickMs: 60_000 }),
    );
    service.start();
    const brains = service.brains();
    expect(brains).toHaveLength(3);
    expect(brains[0]?.name).toBe("MELCHIOR");
    expect(brains[0]?.state).toBe("standby");
    expect(brains[0]?.project).toStrictEqual({ id: "/a/.git", name: "a", path: "/a" });
    expect(brains[1]?.state).toBe("not-active");
    expect(brains[2]?.state).toBe("not-active");
  });

  test("a source event runs a step without refresh(): new session lands on BALTHASAR", () => {
    const a = sess("a", "10:30");
    const b = sess("b", "10:30");
    const source = createStubAgentSource([a]);
    const service = track(
      createMagiService({ source, idleMs: IDLE, waitingMs: WAITING, now: () => ms("10:30"), tickMs: 60_000 }),
    );
    service.start();
    source.setSessions([a, b]);
    source.emit({ type: "session-added", session: b });
    const brains = service.brains();
    expect(brains[0]?.project?.id).toBe("/a/.git");
    expect(brains[1]?.project).toStrictEqual({ id: "/b/.git", name: "b", path: "/b" });
    expect(brains[1]?.state).toBe("standby");
    expect(brains[2]?.state).toBe("not-active");
  });

  test("refresh() runs one step with current sessions", () => {
    const a = sess("a", "10:30");
    const b = sess("b", "10:30");
    const source = createStubAgentSource([a]);
    const service = track(
      createMagiService({ source, idleMs: IDLE, waitingMs: WAITING, now: () => ms("10:30"), tickMs: 60_000 }),
    );
    service.start();
    source.setSessions([a, b]);
    expect(service.brains()[1]?.state).toBe("not-active");
    service.refresh();
    expect(service.brains()[1]?.project?.id).toBe("/b/.git");
  });

  test("the timer frees a brain past the idle timeout with no events", async () => {
    let t = ms("10:30");
    const source = createStubAgentSource([sess("a", "10:30")]);
    const service = track(
      createMagiService({ source, idleMs: IDLE, waitingMs: WAITING, now: () => t, tickMs: 10 }),
    );
    service.start();
    expect(service.brains()[0]?.state).toBe("standby");
    t = ms("12:00");
    await Bun.sleep(60);
    const first = service.brains()[0];
    expect(first?.state).toBe("not-active");
    expect(first?.project).toBeNull();
  });

  test("the clock is read through now(): a live session stays held while time does not advance", async () => {
    const source = createStubAgentSource([sess("a", "10:30")]);
    const service = track(
      createMagiService({ source, idleMs: IDLE, waitingMs: WAITING, now: () => ms("10:45"), tickMs: 10 }),
    );
    service.start();
    await Bun.sleep(60);
    expect(service.brains()[0]?.state).toBe("standby");
    expect(service.brains()[0]?.project?.id).toBe("/a/.git");
  });

  test("after stop(), events and ticks change nothing", async () => {
    let t = ms("10:30");
    const a = sess("a", "10:30");
    const b = sess("b", "10:30");
    const source = createStubAgentSource([a]);
    const service = track(
      createMagiService({ source, idleMs: IDLE, waitingMs: WAITING, now: () => t, tickMs: 10 }),
    );
    service.start();
    const before = service.brains();
    service.stop();
    source.setSessions([a, b]);
    source.emit({ type: "session-added", session: b });
    t = ms("12:00");
    await Bun.sleep(60);
    expect(service.brains()).toStrictEqual(before);
    service.refresh();
    expect(service.brains()).toStrictEqual(before);
  });

  test("mutating the array returned by brains() does not change the next brains()", () => {
    const source = createStubAgentSource([sess("a", "10:30")]);
    const service = track(
      createMagiService({ source, idleMs: IDLE, waitingMs: WAITING, now: () => ms("10:30"), tickMs: 60_000 }),
    );
    service.start();
    const snapshot = structuredClone(service.brains());
    const copy = service.brains();
    copy.reverse();
    copy.pop();
    const first = copy[copy.length - 1];
    if (first) {
      first.state = "waiting";
      first.project = null;
    }
    expect(service.brains()).toStrictEqual(snapshot);
  });
});
