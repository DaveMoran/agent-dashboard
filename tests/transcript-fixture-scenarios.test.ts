import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { classifyLine } from "../src/agents/transcripts/entry";
import { applyEntry, initialSessionState, type SessionStateT } from "../src/agents/transcripts/session-state";
import { combineState, isSubagentRunning } from "../src/agents/transcripts/subagents";
import { FIXTURES } from "./helpers";

const ROOT = path.join(FIXTURES, "transcripts");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(path.join(dir, e.name))
      : e.name.endsWith(".jsonl")
        ? [path.join(dir, e.name)]
        : [],
  );
}

function fold(file: string): { state: SessionStateT; issues: string[] } {
  const parts = readFileSync(file, "utf8").split("\n");
  parts.pop(); // trailing segment: empty, or a partial line without newline
  let state = initialSessionState();
  const issues: string[] = [];
  for (const line of parts) {
    const r = classifyLine(line);
    if ("issue" in r) issues.push(r.issue.reason);
    else state = applyEntry(state, r.entry);
  }
  return { state, issues };
}

interface Scenario {
  sessions: Record<string, { state: SessionStateT; issues: string[] }>;
  subs: Record<string, Record<string, SessionStateT>>;
}

function load(name: string): Scenario {
  const out: Scenario = { sessions: {}, subs: {} };
  for (const file of walk(path.join(ROOT, name))) {
    const rel = path.relative(path.join(ROOT, name), file).split(path.sep);
    if (rel.includes("subagents")) {
      const sid = rel[rel.length - 3]!;
      out.subs[sid] ??= {};
      out.subs[sid][path.basename(file).replace(/^agent-|\.jsonl$/g, "")] = fold(file).state;
    } else {
      out.sessions[path.basename(file, ".jsonl")] = fold(file);
    }
  }
  return out;
}

const id = (d: string) => `${d.repeat(8)}-${d.repeat(4)}-${d.repeat(4)}-${d.repeat(4)}-${d.repeat(12)}`;
const T = (t: string) => `2026-10-15T${t}.000Z`;

function running(s: Scenario, sid: string): string[] {
  const parent = s.sessions[sid]!.state;
  return Object.entries(s.subs[sid] ?? {})
    .filter(([a, sub]) => isSubagentRunning(a, sub, parent))
    .map(([a]) => a);
}

test("plain-turn ends standby with the model and no issues", () => {
  const { state, issues } = load("plain-turn").sessions[id("1")]!;
  expect(issues).toEqual([]);
  expect(state.state).toBe("standby");
  expect(state.model).toBe("claude-opus-5-5");
  expect(state.sessionId).toBe(id("1"));
});

test("tool-calls ends working with only tu3 open", () => {
  const { state, issues } = load("tool-calls").sessions[id("2")]!;
  expect(issues).toEqual([]);
  expect(state.state).toBe("working");
  expect(state.openToolUseIds).toEqual(["tu3"]);
});

test("foreground-subagent: working with one running subagent", () => {
  const s = load("foreground-subagent");
  const sid = id("3");
  expect(s.sessions[sid]!.state.state).toBe("working");
  expect(s.sessions[sid]!.state.openToolUseIds).toEqual(["tu1"]);
  const sub = s.subs[sid]!.a0000000000000001!;
  expect(sub.state).toBe("working");
  expect(sub.model).toBe("claude-sonnet-5-5");
  expect(running(s, sid)).toEqual(["a0000000000000001"]);
});

test("background-subagents: turn standby, one running subagent, combined working", () => {
  const s = load("background-subagents");
  const sid = id("4");
  const parent = s.sessions[sid]!.state;
  expect(s.sessions[sid]!.issues).toEqual([]);
  expect(parent.state).toBe("standby");
  expect(parent.openToolUseIds).toEqual([]);
  expect(Object.keys(parent.completedAgentIds)).toEqual(["a0000000000000002"]);
  const subs = s.subs[sid]!;
  expect(subs.a0000000000000001!.state).toBe("standby");
  expect(subs.a0000000000000002!.state).toBe("working");
  expect(subs.a0000000000000003!.state).toBe("working");
  expect(Date.parse(subs.a0000000000000002!.lastActivity!)).toBeLessThan(
    Date.parse(parent.completedAgentIds.a0000000000000002!),
  );
  expect(Date.parse(subs.a0000000000000003!.lastActivity!)).toBeLessThan(
    Date.parse(parent.completedAgentIds.a0000000000000002!),
  );
  expect(running(s, sid)).toEqual(["a0000000000000003"]);
  expect(combineState(parent.state, running(s, sid).length)).toBe("working");
});

test("interrupted ends standby", () => {
  const { state, issues } = load("interrupted").sessions[id("5")]!;
  expect(issues).toEqual([]);
  expect(state.state).toBe("standby");
});

test("non-main: both sessions standby on the sonnet model", () => {
  const s = load("non-main").sessions;
  expect(s[id("6")]!.state.model).toBe("claude-sonnet-5-5");
  expect(s[id("6")]!.state.state).toBe("standby");
  const second = s["67777777-7777-7777-7777-777777777777"]!.state;
  expect(second.model).toBe("claude-sonnet-5-5");
  expect(second.state).toBe("standby");
});

test("two-worktrees: repo session working at 10:05, worktree session standby at 10:02", () => {
  const s = load("two-worktrees").sessions;
  expect(s[id("7")]!.state.state).toBe("working");
  expect(s[id("7")]!.state.lastActivity).toBe(T("10:05:00"));
  expect(s[id("8")]!.state.state).toBe("standby");
  expect(s[id("8")]!.state.lastActivity).toBe(T("10:02:00"));
});

test("malformed: three issues, standby at the end_turn line, partial last line ignored", () => {
  const file = walk(path.join(ROOT, "malformed"))[0]!;
  expect(readFileSync(file, "utf8").endsWith("\n")).toBe(false);
  const { state, issues } = load("malformed").sessions[id("9")]!;
  expect(issues).toEqual(["invalid-json", "not-an-object", "missing-field"]);
  expect(state.state).toBe("standby");
  expect(state.lastActivity).toBe(T("10:00:03"));
});

test("timestamps strictly increase within every fixture file", () => {
  for (const name of readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)) {
    for (const file of walk(path.join(ROOT, name))) {
      let prev = 0;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const r = classifyLine(line);
        if ("issue" in r || r.entry.timestamp === undefined) continue;
        const t = Date.parse(r.entry.timestamp);
        expect(t).toBeGreaterThan(prev);
        prev = t;
      }
    }
  }
});

test("live-shapes: a queued notification closes one agent; continued-in ends a session", () => {
  const s = load("live-shapes");
  const a = s.sessions[id("a")]!;
  expect(a.issues).toEqual([]);
  expect(a.state.state).toBe("working");
  expect(Object.keys(a.state.completedAgentIds)).toEqual(["a1111111111111111"]);
  expect(running(s, id("a"))).toEqual(["a2222222222222222"]);
  const b = s.sessions[id("b")]!;
  expect(b.issues).toEqual([]);
  expect(b.state.state).toBe("standby");
  expect(b.state.ended).toBe(true);
  expect(running(s, id("b"))).toEqual([]);
  expect(combineState(b.state.state, 0)).toBe("standby");
});
