import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { compileMainAgentPattern } from "../src/agents/main-agent";
import type { AgentSourceEvent } from "../src/agents/source";
import { createAttentionSource } from "../src/agents/attention/source";
import { createTranscriptSource } from "../src/agents/transcripts/source";
import { emptyCopy, materializeAttention, scenarioLines } from "./attention-fixtures";
import { makeGitRepo } from "./git-helpers";
import { FIXTURES, cleanupFixtures } from "./helpers";
import { appendLine } from "./transcript-fixtures";

type Attention = ReturnType<typeof createAttentionSource>;

const started: Attention[] = [];
afterEach(async () => {
  while (started.length > 0) await started.pop()!.stop();
  await cleanupFixtures();
});

const pattern = compileMainAgentPattern(undefined).regex;
const NOW = Date.parse("2026-10-15T10:01:00.000Z");
const T = (t: string) => `2026-10-15T${t}Z`;
const sid = (nn: string) => `a0050000-0000-0000-0000-0000000000${nn}`;

interface Snap {
  ts: string;
  state: string | undefined;
  stateSince: string | undefined;
  runningSubagents: number | undefined;
}

interface Run {
  attention: Attention;
  events: AgentSourceEvent[];
  lines: { file: string; text: string; ts: string }[];
  feed: (line: { file: string; text: string; ts: string }) => Promise<void>;
  snaps: Snap[];
}

async function prepare(scenario: string, session: string): Promise<Run> {
  const REPO = await makeGitRepo();
  const m = await materializeAttention(scenario, { REPO });
  const lines = scenarioLines(m.dir);
  emptyCopy(m.dir);
  const base = createTranscriptSource({
    root: m.transcriptsRoot,
    mainAgentPattern: pattern,
    pollIntervalMs: 0,
  });
  const attention = createAttentionSource({
    base,
    eventsFile: m.eventsFile,
    pollIntervalMs: 0,
    now: () => NOW,
  });
  started.push(attention);
  const events: AgentSourceEvent[] = [];
  attention.subscribe((e) => events.push(e));
  await attention.start();
  const snaps: Snap[] = [];
  const feed = async (line: { file: string; text: string; ts: string }) => {
    appendLine(line.file, line.text);
    await base.refresh();
    await attention.refresh();
    const s = attention.sessions().find((x) => x.sessionId === session);
    snaps.push({
      ts: line.ts,
      state: s?.state,
      stateSince: s?.stateSince,
      runningSubagents: s?.runningSubagents,
    });
  };
  return { attention, events, lines, feed, snaps };
}

async function replay(scenario: string, session: string): Promise<Run> {
  const run = await prepare(scenario, session);
  for (const l of run.lines) await run.feed(l);
  return run;
}

function changes(events: AgentSourceEvent[]) {
  return events.flatMap((e) => (e.type === "state-changed" ? [e] : []));
}
const pairs = (events: AgentSourceEvent[]) => changes(events).map((e) => [e.to, e.at]);

function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      for (const [k, v] of Object.entries(hashTree(p))) out[`${e.name}/${k}`] = v;
    } else out[e.name] = createHash("sha256").update(readFileSync(p)).digest("hex");
  }
  return out;
}

function expectChain(events: AgentSourceEvent[]) {
  const cs = changes(events);
  expect(cs.map((e) => e.from)).toStrictEqual(["working", ...cs.slice(0, -1).map((e) => e.to)]);
  for (const e of cs) {
    expect(e.from).not.toBe(e.to);
    expect(e.sessionId).toBeString();
    expect(e.session.state).toBe(e.to);
  }
}

// NOTE: a session's first state arrives with session-added (004 guarantee 3 and the
// transcript source emit no state-changed for it), so no sequence starts with working@10:00:00.

test("S01 permission wait on the main agent: waiting at the request, working at the tool result, standby at the end", async () => {
  const { events, attention, snaps } = await replay("permission-main", sid("01"));
  expect(pairs(events)).toStrictEqual([
    ["waiting", T("10:00:02.000")],
    ["working", T("10:00:10.000")],
    ["standby", T("10:00:11.000")],
  ]);
  expectChain(events);
  const final = attention.sessions().find((s) => s.sessionId === sid("01"))!;
  expect(final.state).toBe("standby");
  expect(final.runningSubagents).toBe(0);
  expect(final.stateSince).toBe(T("10:00:11.000"));
  expect(snaps.find((s) => s.ts === T("10:00:02.000"))).toStrictEqual({
    ts: T("10:00:02.000"),
    state: "waiting",
    stateSince: T("10:00:02.000"),
    runningSubagents: 0,
  });
  expect(snaps.find((s) => s.ts === T("10:00:10.000"))).toStrictEqual({
    ts: T("10:00:10.000"),
    state: "working",
    stateSince: T("10:00:10.000"),
    runningSubagents: 0,
  });
  expect(attention.hookStatus()).toStrictEqual({ seen: true, lastEventAt: T("10:00:02.000") });
});

test("S02 question wait ends on the PostToolUse hook line before the transcript result", async () => {
  const { events, attention, snaps } = await replay("question-main", sid("02"));
  expect(pairs(events)).toStrictEqual([
    ["waiting", T("10:00:01.200")],
    ["working", T("10:00:20.000")],
    ["standby", T("10:00:21.000")],
  ]);
  expectChain(events);
  expect(attention.sessions().find((s) => s.sessionId === sid("02"))!.state).toBe("standby");
  const waiting = snaps.find((s) => s.ts === T("10:00:01.200"))!;
  expect(waiting.state).toBe("waiting");
  expect(waiting.stateSince).toBe(T("10:00:01.200"));
  // PreToolUse of an ordinary tool does not make the session wait.
  expect(snaps.find((s) => s.ts === T("10:00:00.500"))!.state).toBe("working");
});

test("S03 an interrupt entry ends the wait and the turn at once: one change to standby", async () => {
  const { events, attention, snaps } = await replay("interrupted-wait", sid("03"));
  expect(pairs(events)).toStrictEqual([
    ["waiting", T("10:00:02.000")],
    ["standby", T("10:00:05.000")],
  ]);
  expectChain(events);
  const final = attention.sessions().find((s) => s.sessionId === sid("03"))!;
  expect(final.state).toBe("standby");
  expect(final.stateSince).toBe(T("10:00:05.000"));
  expect(snaps.find((s) => s.ts === T("10:00:02.000"))!.state).toBe("waiting");
});

test("S04 a subagent wait holds the session waiting with 2 running subagents until its own entry clears it", async () => {
  const { events, attention, snaps } = await replay("subagent-wait", sid("04"));
  expect(pairs(events)).toStrictEqual([
    ["waiting", T("10:00:04.500")],
    ["working", T("10:00:20.000")],
    ["standby", T("10:00:30.000")],
  ]);
  expectChain(events);
  const held = snaps.filter((s) => s.ts >= T("10:00:04.500") && s.ts < T("10:00:20.000"));
  expect(held.length).toBeGreaterThanOrEqual(6);
  for (const s of held) {
    expect(s.state).toBe("waiting");
    expect(s.stateSince).toBe(T("10:00:04.500"));
    expect(s.runningSubagents).toBe(2);
  }
  const final = attention.sessions().find((s) => s.sessionId === sid("04"))!;
  expect(final.state).toBe("standby");
  expect(final.runningSubagents).toBe(0);
  // The first subagent's entries before the wait do not turn the session red.
  expect(snaps.filter((s) => s.ts < T("10:00:04.500")).every((s) => s.state === "working")).toBe(true);
});

test("S05 a main-agent wait is not cleared by a background subagent's entries", async () => {
  const { events, attention, snaps } = await replay("main-wait-bg-subagent", sid("05"));
  expect(pairs(events)).toStrictEqual([
    ["waiting", T("10:00:03.500")],
    ["working", T("10:00:15.000")],
  ]);
  expectChain(events);
  const held = snaps.filter((s) => s.ts >= T("10:00:03.500") && s.ts < T("10:00:15.000"));
  expect(held.length).toBeGreaterThanOrEqual(4);
  for (const s of held) {
    expect(s.state).toBe("waiting");
    expect(s.stateSince).toBe(T("10:00:03.500"));
    expect(s.runningSubagents).toBe(1);
  }
  const final = attention.sessions().find((s) => s.sessionId === sid("05"))!;
  expect(final.state).toBe("working");
  expect(final.runningSubagents).toBe(1);
});

test("passed-through base events carry the combined state and never a no-op state change", async () => {
  const { events } = await replay("permission-main", sid("01"));
  expect(events.filter((e) => e.type === "session-added")).toHaveLength(1);
  for (const e of events) {
    if (e.type === "session-added" || e.type === "session-updated")
      expect(e.session.sessionId).toBe(sid("01"));
  }
  const standby = changes(events).at(-1)!;
  expect(standby.session.state).toBe("standby");
  expect(standby.session.stateSince).toBe(T("10:00:11.000"));
  expect(events.some((e) => e.type === "session-ended")).toBe(false);
});

test("a listener that unsubscribed gets nothing", async () => {
  const run = await prepare("permission-main", sid("01"));
  const got: AgentSourceEvent[] = [];
  const off = run.attention.subscribe((e) => got.push(e));
  off();
  for (const l of run.lines) await run.feed(l);
  expect(got).toStrictEqual([]);
  expect(changes(run.events)).toHaveLength(3);
});

test("after stop() nothing is emitted", async () => {
  const run = await prepare("permission-main", sid("01"));
  const first = run.lines.slice(0, 3); // user, assistant, PermissionRequest
  for (const l of first) await run.feed(l);
  expect(pairs(run.events)).toStrictEqual([["waiting", T("10:00:02.000")]]);
  await run.attention.stop();
  const before = run.events.length;
  for (const l of run.lines.slice(3)) await run.feed(l);
  expect(run.events).toHaveLength(before);
});

test("replaying scenarios leaves fixtures/attention byte-identical", async () => {
  const dir = path.join(FIXTURES, "attention");
  const before = hashTree(dir);
  expect(Object.keys(before).length).toBeGreaterThan(10);
  await replay("permission-main", sid("01"));
  await replay("subagent-wait", sid("04"));
  expect(hashTree(dir)).toStrictEqual(before);
});
