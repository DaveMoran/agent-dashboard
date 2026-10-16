import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compileMainAgentPattern } from "../src/agents/main-agent";
import type { AgentSourceEvent } from "../src/agents/source";
import { buildSessionsResponse } from "../src/server/sessions";
import { createAttentionSource } from "../src/agents/attention/source";
import { createTranscriptSource } from "../src/agents/transcripts/source";
import { emptyCopy, materializeAttention, scenarioLines } from "./attention-fixtures";
import { makeGitRepo } from "./git-helpers";
import { FIXTURES, cleanupFixtures } from "./helpers";
import { appendLine, appendRaw, materializeTranscripts } from "./transcript-fixtures";

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

// --- T011: read order independence (FR-010, SC-002) ---

type Order = "ts" | "transcripts-first" | "events-first";
const ORDERS: Order[] = ["ts", "transcripts-first", "events-first"];

const isEventsLine = (l: { file: string }) => path.basename(l.file) === "events.jsonl";

async function replayOrdered(scenario: string, order: Order) {
  const REPO = await makeGitRepo();
  const m = await materializeAttention(scenario, { REPO });
  const all = scenarioLines(m.dir);
  emptyCopy(m.dir);
  const ordered =
    order === "ts"
      ? all
      : order === "transcripts-first"
        ? [...all.filter((l) => !isEventsLine(l)), ...all.filter(isEventsLine)]
        : [...all.filter(isEventsLine), ...all.filter((l) => !isEventsLine(l))];
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
  for (const l of ordered) {
    appendLine(l.file, l.text);
    await base.refresh();
    await attention.refresh();
  }
  const sessions = attention.sessions();
  const projected = sessions
    .map((s) => ({ sessionId: s.sessionId, state: s.state, runningSubagents: s.runningSubagents }))
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  return { events, projected, sessions };
}

const ORDER_CASES: {
  scenario: string;
  expected: { nn: string; state: "working" | "standby" | "waiting"; running: number }[] | null;
}[] = [
  { scenario: "permission-main", expected: [{ nn: "01", state: "standby", running: 0 }] },
  { scenario: "question-main", expected: [{ nn: "02", state: "standby", running: 0 }] },
  { scenario: "interrupted-wait", expected: [{ nn: "03", state: "standby", running: 0 }] },
  { scenario: "subagent-wait", expected: [{ nn: "04", state: "standby", running: 0 }] },
  { scenario: "main-wait-bg-subagent", expected: [{ nn: "05", state: "working", running: 1 }] },
  {
    scenario: "unsorted-events",
    expected: [
      { nn: "06", state: "working", running: 0 },
      { nn: "07", state: "waiting", running: 0 },
    ],
  },
  // session end is T016: only agreement between orders is pinned here.
  { scenario: "session-end", expected: null },
];

for (const c of ORDER_CASES) {
  test(`${c.scenario}: ts, transcripts-first and events-first reach the same final sessions`, async () => {
    const results = [];
    for (const order of ORDERS) results.push(await replayOrdered(c.scenario, order));
    const [a, b, d] = results;
    expect(b!.projected).toStrictEqual(a!.projected);
    expect(d!.projected).toStrictEqual(a!.projected);
    if (c.expected) {
      expect(a!.projected).toStrictEqual(
        c.expected.map((e) => ({ sessionId: sid(e.nn), state: e.state, runningSubagents: e.running })),
      );
    } else {
      expect(a!.projected.length).toBeGreaterThan(0);
    }
  });
}

test("transcripts-first: S01, S02 and S03 never emit a change to waiting", async () => {
  for (const [scenario, nn] of [
    ["permission-main", "01"],
    ["question-main", "02"],
    ["interrupted-wait", "03"],
  ] as const) {
    const { events } = await replayOrdered(scenario, "transcripts-first");
    const waits = changes(events).filter((e) => e.to === "waiting" && e.sessionId === sid(nn));
    expect(waits).toStrictEqual([]);
  }
});

test("unsorted-events: S07 is waiting since 10:00:05 and S06 is not waiting, in every order", async () => {
  for (const order of ORDERS) {
    const { sessions } = await replayOrdered("unsorted-events", order);
    const s7 = sessions.find((s) => s.sessionId === sid("07"))!;
    const s6 = sessions.find((s) => s.sessionId === sid("06"))!;
    expect(s7.state).toBe("waiting");
    expect(s7.stateSince).toBe(T("10:00:05.000"));
    expect(s6.state).not.toBe("waiting");
  }
});

// T012: unknown sessions and the hold timeout (FR-011, research R7, US2 scenario 4).
const S10 = sid("10");

async function lateSession(nowIso: string, opts: { holdMs?: number; resultLine?: string } = {}) {
  const REPO = await makeGitRepo();
  const m = await materializeAttention("late-session", { REPO });
  const base = createTranscriptSource({
    root: m.transcriptsRoot,
    mainAgentPattern: pattern,
    pollIntervalMs: 0,
  });
  const attention = createAttentionSource({
    base,
    eventsFile: m.eventsFile,
    pollIntervalMs: 0,
    now: () => Date.parse(nowIso),
    ...(opts.holdMs === undefined ? {} : { holdMs: opts.holdMs }),
  });
  started.push(attention);
  const events: AgentSourceEvent[] = [];
  attention.subscribe((e) => events.push(e));
  await attention.start();
  await base.refresh();
  await attention.refresh();
  const later = path.join(m.dir, "later", "-repo", `${S10}.jsonl`);
  if (opts.resultLine !== undefined) appendLine(later, opts.resultLine);
  const move = async () => {
    renameSync(later, path.join(m.transcriptsRoot, "-repo", `${S10}.jsonl`));
    await base.refresh();
    await attention.refresh();
  };
  return { attention, events, move };
}

const toolResultTu1 = JSON.stringify({
  type: "user",
  timestamp: T("10:00:03.000"),
  sessionId: S10,
  cwd: "/repo",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok" }] },
});

test("T012 hook events for an unknown session never create a session", async () => {
  const { attention, events } = await lateSession("2026-10-15T10:05:00.000Z");
  expect(attention.sessions()).toStrictEqual([]);
  expect(events).toStrictEqual([]);
});

test("T012 a held wait is applied when the transcript appears (US2 scenario 4)", async () => {
  const { attention, move } = await lateSession("2026-10-15T10:05:00.000Z");
  await move();
  const s = attention.sessions().find((x) => x.sessionId === S10)!;
  expect(attention.sessions()).toHaveLength(1);
  expect(s.state).toBe("waiting");
  expect(s.stateSince).toBe(T("10:00:02.000"));
});

test("T012 a record older than holdMs is dropped on an events pass, so the session is working", async () => {
  const { attention, move } = await lateSession("2026-10-15T10:20:00.000Z");
  await move();
  const s = attention.sessions().find((x) => x.sessionId === S10)!;
  expect(attention.sessions()).toHaveLength(1);
  expect(s.state).toBe("working");
  expect(s.stateSince).not.toBe(T("10:00:02.000"));
});

test("T012 a custom holdMs is respected", async () => {
  const dropped = await lateSession("2026-10-15T10:02:00.000Z", { holdMs: 60_000 });
  await dropped.move();
  expect(dropped.attention.sessions().find((x) => x.sessionId === S10)!.state).toBe("working");
});

test("T012 a record inside a custom holdMs is kept", async () => {
  const kept = await lateSession("2026-10-15T10:00:30.000Z", { holdMs: 60_000 });
  await kept.move();
  const s = kept.attention.sessions().find((x) => x.sessionId === S10)!;
  expect(s.state).toBe("waiting");
  expect(s.stateSince).toBe(T("10:00:02.000"));
});

test("T012 a held wait whose tool result is already in the moved transcript is not waiting", async () => {
  const { attention, move } = await lateSession("2026-10-15T10:05:00.000Z", {
    resultLine: toolResultTu1,
  });
  await move();
  const s = attention.sessions().find((x) => x.sessionId === S10)!;
  expect(s.state).not.toBe("waiting");
});

// --- T015: missing, appearing and replaced events files (FR-006, FR-016, research R9) ---

const TRANSCRIPT_SCENARIOS = readdirSync(path.join(FIXTURES, "transcripts"))
  .filter((n) => !n.startsWith("_") && !n.endsWith(".md"))
  .sort();

async function noFileRun(scenario: string) {
  const REPO = await makeGitRepo();
  const PLAIN = await makeGitRepo();
  const dirs = { REPO, WORKTREE: `${REPO}-wt`, PLAIN, MISSING: `${PLAIN}/gone` };
  const root = await materializeTranscripts(scenario, dirs);
  const base = createTranscriptSource({ root, mainAgentPattern: pattern, pollIntervalMs: 0 });
  const eventsFile = path.join(path.dirname(root), "no-hooks", "events.jsonl");
  const attention = createAttentionSource({ base, eventsFile, pollIntervalMs: 0, now: () => NOW });
  started.push(attention);
  const baseEvents: AgentSourceEvent[] = [];
  const attEvents: AgentSourceEvent[] = [];
  base.subscribe((e) => baseEvents.push(e));
  attention.subscribe((e) => attEvents.push(e));
  await attention.start();
  await base.refresh();
  await attention.refresh();
  return { base, attention, baseEvents, attEvents, eventsFile };
}

test("T015 there is at least one 004 transcript scenario to compare", () => {
  expect(TRANSCRIPT_SCENARIOS).toContain("plain-turn");
  expect(TRANSCRIPT_SCENARIOS).toContain("background-subagents");
});

for (const scenario of TRANSCRIPT_SCENARIOS) {
  test(`T015 no events file: ${scenario} behaves exactly like the transcript source (US4 scenario 1, SC-005)`, async () => {
    const { base, attention, baseEvents, attEvents, eventsFile } = await noFileRun(scenario);
    expect(existsSync(eventsFile)).toBe(false);
    expect(base.sessions().length).toBeGreaterThan(0);
    expect(attention.sessions()).toStrictEqual(base.sessions());
    expect(baseEvents.length).toBeGreaterThan(0);
    expect(attEvents).toStrictEqual(baseEvents);
    expect(attention.issues()).toStrictEqual(base.issues());
    expect(attention.hookStatus()).toStrictEqual({ seen: false, lastEventAt: null });
    expect(existsSync(eventsFile)).toBe(false);
  });
}

async function permissionRun() {
  const REPO = await makeGitRepo();
  const m = await materializeAttention("permission-main", { REPO });
  const lines = scenarioLines(m.dir);
  emptyCopy(m.dir);
  const eventLine = lines.find(isEventsLine)!.text;
  const transcriptLines = lines.filter((l) => !isEventsLine(l));
  rmSync(m.eventsFile);
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
  await attention.start();
  // user prompt, assistant tool_use for the permission-gated tool
  for (const l of transcriptLines.slice(0, 2)) {
    appendLine(l.file, l.text);
    await base.refresh();
    await attention.refresh();
  }
  return { base, attention, m, eventLine };
}

const stateOf = (a: Attention) => a.sessions().find((s) => s.sessionId === sid("01"))?.state;

test("T015 an events file created after start takes effect on the next refresh (US4 scenario 2)", async () => {
  const { attention, m, eventLine } = await permissionRun();
  expect(stateOf(attention)).toBe("working");
  expect(attention.hookStatus()).toStrictEqual({ seen: false, lastEventAt: null });
  mkdirSync(path.dirname(m.eventsFile), { recursive: true });
  writeFileSync(m.eventsFile, `${eventLine}\n`);
  await attention.refresh();
  expect(stateOf(attention)).toBe("waiting");
  expect(attention.sessions().find((s) => s.sessionId === sid("01"))!.stateSince).toBe(T("10:00:02.000"));
  expect(attention.hookStatus()).toStrictEqual({ seen: true, lastEventAt: T("10:00:02.000") });
  expect(attention.issues()).toStrictEqual([]);
});

test("T015 a replaced, shorter events file raises no issue and keeps the recorded wait (US4 scenario 3)", async () => {
  const { base, attention, m, eventLine } = await permissionRun();
  writeFileSync(m.eventsFile, `${eventLine}\n`);
  await attention.refresh();
  expect(stateOf(attention)).toBe("waiting");
  const replacement = `${JSON.stringify({
    ts: T("10:00:03.000"),
    session: sid("09"),
    event: "UserPromptSubmit",
  })}\n`;
  expect(replacement.length).toBeLessThan(eventLine.length + 1);
  writeFileSync(m.eventsFile, replacement);
  await attention.refresh();
  expect(attention.issues()).toStrictEqual([]);
  expect(attention.issues()).toStrictEqual(base.issues());
  expect(stateOf(attention)).toBe("waiting");
  expect(attention.sessions().find((s) => s.sessionId === sid("01"))!.stateSince).toBe(T("10:00:02.000"));
  expect(attention.hookStatus().seen).toBe(true);
});

test("T015 deleting the events file raises no issue and keeps the recorded wait", async () => {
  const { base, attention, m, eventLine } = await permissionRun();
  writeFileSync(m.eventsFile, `${eventLine}\n`);
  await attention.refresh();
  expect(stateOf(attention)).toBe("waiting");
  rmSync(m.eventsFile);
  await attention.refresh();
  expect(attention.issues()).toStrictEqual([]);
  expect(attention.issues()).toStrictEqual(base.issues());
  expect(stateOf(attention)).toBe("waiting");
  expect(attention.hookStatus()).toStrictEqual({ seen: true, lastEventAt: T("10:00:02.000") });
});

// --- T016: session end and revival (FR-012, research R8, contract guarantees 10-11) ---

const S08 = sid("08");
const S09 = sid("09");
const ofSession = (e: AgentSourceEvent, id: string) => {
  if (e.type === "session-ended") return e.sessionId === id;
  if (e.type === "session-added" || e.type === "session-updated" || e.type === "state-changed") {
    return e.session.sessionId === id;
  }
  return false;
};

test("S08 ends once at the SessionEnd time and stays out of sessions() after the bookkeeping line; S09 stays standby", async () => {
  const { attention, events, lines, feed } = await prepare("session-end", S08);
  const listed: { ts: string; listed: boolean; evCount: number }[] = [];
  for (const l of lines) {
    await feed(l);
    listed.push({
      ts: l.ts,
      listed: attention.sessions().some((s) => s.sessionId === S08),
      evCount: events.length,
    });
  }
  const added = events.find((e) => e.type === "session-added" && e.session.sessionId === S08);
  expect(added).toBeDefined();
  const projectId = (added as Extract<AgentSourceEvent, { type: "session-added" }>).session.projectId;

  const ended = events.filter((e) => e.type === "session-ended" && e.sessionId === S08);
  expect(ended).toStrictEqual([{ type: "session-ended", sessionId: S08, projectId, at: T("10:00:10.000") }]);

  // Listed before the end, absent from the end on, including after the 10:00:12 bookkeeping line.
  expect(listed.find((x) => x.ts === T("10:00:01.500"))!.listed).toBe(true);
  expect(listed.find((x) => x.ts === T("10:00:10.000"))!.listed).toBe(false);
  const last = listed[listed.length - 1]!;
  expect(last.ts).toBe(T("10:00:12.000"));
  expect(last.listed).toBe(false);
  expect(attention.sessions().some((s) => s.sessionId === S08)).toBe(false);

  // Nothing about S08 after the session-ended event.
  const endIdx = events.findIndex((e) => e.type === "session-ended" && e.sessionId === S08);
  expect(events.slice(endIdx + 1).filter((e) => ofSession(e, S08))).toStrictEqual([]);

  // S09 (timestamp order): its SessionEnd (10:00:03) is read before its final turn (10:00:05),
  // so it really is ended for a moment, then the turn revives it as standby.
  const s09Events = events.filter((e) => ofSession(e, S09));
  const s09End = s09Events.filter((e) => e.type === "session-ended");
  expect(s09End).toStrictEqual([{ type: "session-ended", sessionId: S09, projectId, at: T("10:00:03.000") }]);
  const endAt = s09Events.findIndex((e) => e.type === "session-ended");
  const revived = s09Events.slice(endAt + 1).filter((e) => e.type === "session-added");
  expect(revived.length).toBe(1);
  expect((revived[0] as Extract<AgentSourceEvent, { type: "session-added" }>).session.state).toBe("standby");
  const s09 = attention.sessions().find((s) => s.sessionId === S09)!;
  expect(s09.state).toBe("standby");
});

test("a prompt appended to the ended S08 revives it with session-added in state working; /api/sessions follows", async () => {
  const { attention, events, lines, feed } = await replay("session-end", S08);
  const base = buildSessionsResponse(attention.sessions());
  expect(base.projects.flatMap((p) => p.sessions.map((s) => s.sessionId))).toStrictEqual([S09]);

  const userLine = lines.find(
    (l) => !isEventsLine(l) && l.file.endsWith(`${S08}.jsonl`) && l.text.includes('"type":"user"'),
  )!;
  const prompt = JSON.stringify({
    ...JSON.parse(userLine.text),
    timestamp: T("10:05:00.000"),
    message: { role: "user", content: "Back again" },
  });
  const before = events.length;
  await feed({ file: userLine.file, text: prompt, ts: T("10:05:00.000") });

  const revived = events.slice(before).filter((e) => e.type === "session-added");
  expect(revived.length).toBe(1);
  const r = revived[0] as Extract<AgentSourceEvent, { type: "session-added" }>;
  expect(r.session.sessionId).toBe(S08);
  expect(r.session.state).toBe("working");
  expect(events.slice(before).filter((e) => e.type === "session-ended")).toStrictEqual([]);

  const live = attention.sessions().find((s) => s.sessionId === S08)!;
  expect(live.state).toBe("working");
  const resp = buildSessionsResponse(attention.sessions());
  expect(resp.projects.flatMap((p) => p.sessions.map((s) => s.sessionId)).sort()).toStrictEqual([S08, S09]);
});

test("session-end: S08 ends and S09 is standby in every read order; S09 only ends when its end is read before its last turn", async () => {
  for (const order of ORDERS) {
    const { projected, events } = await replayOrdered("session-end", order);
    expect(projected).toStrictEqual([{ sessionId: S09, state: "standby", runningSubagents: 0 }]);
    expect(
      events.filter((e) => e.type === "session-ended" && e.sessionId === S08).length,
    ).toBeLessThanOrEqual(1);
    const endIdx = events.findIndex((e) => e.type === "session-ended" && e.sessionId === S08);
    if (endIdx >= 0) expect(events.slice(endIdx + 1).filter((e) => ofSession(e, S08))).toStrictEqual([]);
    const s09Ended = events.filter((e) => e.type === "session-ended" && e.sessionId === S09);
    expect(s09Ended.length).toBe(order === "ts" ? 1 : 0);
    if (order === "events-first") {
      expect(events.filter((e) => e.type === "session-added" && e.session.sessionId === S09).length).toBe(1);
    }
  }
});

// --- T017: hook status and ingest issues (FR-015, contract health) ---

test("T017 malformed-events: hookStatus ignores invalid lines and follows the partial line once completed; issues list the four bad lines", async () => {
  const { attention, lines, feed } = await prepare("malformed-events", sid("11"));
  const eventsFile = lines.find((l) => l.file.endsWith("events.jsonl"))!.file;
  expect(attention.hookStatus()).toStrictEqual({ seen: false, lastEventAt: null });
  // Events lines in their original file order; the fixture's last line has no trailing newline and stays partial.
  const raw = readFileSync(
    path.join(FIXTURES, "attention", "malformed-events", "events.jsonl"),
    "utf8",
  ).split("\n");
  const key = (text: string) => raw.findIndex((r) => r.slice(0, 40) === text.slice(0, 40));
  const eventLines = lines.filter((l) => l.file === eventsFile).sort((x, y) => key(x.text) - key(y.text));
  expect(eventLines).toHaveLength(6);
  for (const l of lines) if (l.file !== eventsFile) await feed(l);
  for (const [i, l] of eventLines.entries()) {
    appendRaw(eventsFile, i === eventLines.length - 1 ? l.text : `${l.text}\n`);
  }
  await attention.refresh();
  expect(attention.hookStatus()).toStrictEqual({ seen: true, lastEventAt: T("10:00:03.000") });

  appendRaw(eventsFile, "\n");
  await attention.refresh();
  expect(attention.hookStatus()).toStrictEqual({ seen: true, lastEventAt: T("10:00:04.000") });

  const mine = attention.issues().filter((i) => i.file === eventsFile);
  expect(mine.map((i) => [i.reason, i.detail])).toStrictEqual([
    ["invalid-json", mine[0]!.detail],
    ["not-an-object", mine[1]!.detail],
    ["missing-field", "session"],
    ["missing-field", "ts"],
  ]);
  expect(mine.length).toBe(4);
  for (let i = 1; i < mine.length; i++) expect(mine[i - 1]!.offset).toBeLessThan(mine[i]!.offset);
});
