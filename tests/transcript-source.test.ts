import { afterEach, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileMainAgentPattern } from "../src/agents/main-agent";
import type { AgentSession, AgentSourceEvent } from "../src/agents/source";
import { createTranscriptSource } from "../src/agents/transcripts/source";
import { addWorktree, commitAll, makeGitRepo, snapshotTree } from "./git-helpers";
import { cleanupFixtures, trackTempDir } from "./helpers";
import { appendLine, appendRaw, materializeTranscripts } from "./transcript-fixtures";

type Source = ReturnType<typeof createTranscriptSource>;

const sources: Source[] = [];
afterEach(async () => {
  while (sources.length > 0) await sources.pop()!.stop();
  await cleanupFixtures();
});

const pattern = compileMainAgentPattern(undefined).regex;
const id = (d: string) => `${d.repeat(8)}-${d.repeat(4)}-${d.repeat(4)}-${d.repeat(4)}-${d.repeat(12)}`;
const T = (t: string) => `2026-10-15T${t}.000Z`;

interface Env {
  REPO: string;
  WORKTREE: string;
  PLAIN: string;
  MISSING: string;
  root: string;
  source: Source;
  events: AgentSourceEvent[];
}

async function makeDirs() {
  const REPO = await makeGitRepo();
  await commitAll(REPO, "init");
  const WORKTREE = await addWorktree(REPO, { newBranch: "wt" });
  const PLAIN = await realpath(await mkdtemp(path.join(os.tmpdir(), "av-plain-")));
  trackTempDir(PLAIN);
  return { REPO, WORKTREE, PLAIN, MISSING: PLAIN + "/gone" };
}

async function setup(
  scenario: string,
  opts: { pollIntervalMs?: number; start?: boolean } = {},
): Promise<Env> {
  const dirs = await makeDirs();
  const root = await materializeTranscripts(scenario, dirs);
  const source = createTranscriptSource({
    root,
    mainAgentPattern: pattern,
    pollIntervalMs: opts.pollIntervalMs ?? 0,
  });
  sources.push(source);
  const events: AgentSourceEvent[] = [];
  source.subscribe((e) => events.push(e));
  if (opts.start !== false) await source.start();
  return { ...dirs, root, source, events };
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".jsonl") ? [path.join(dir, e.name)] : [],
  );
}
const fileOf = (root: string, name: string) => files(root).find((f) => f.endsWith(name))!;
const bySession = (env: Env, sid: string) => env.source.sessions().find((s) => s.sessionId === sid)!;

const prompt = (sid: string, cwd: string, at: string) =>
  JSON.stringify({ type: "user", timestamp: T(at), sessionId: sid, cwd, message: { role: "user", content: "More" } });
const final = (sid: string, cwd: string, at: string) =>
  JSON.stringify({
    type: "assistant",
    timestamp: T(at),
    sessionId: sid,
    cwd,
    message: { id: "x", model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
  });
const other = (sid: string, cwd: string, at: string) =>
  JSON.stringify({ type: "file-history-snapshot", timestamp: T(at), sessionId: sid, cwd });
const stateChanges = (events: AgentSourceEvent[]) =>
  events.filter((e): e is Extract<AgentSourceEvent, { type: "state-changed" }> => e.type === "state-changed");

test("plain-turn gives the full expected session", async () => {
  const env = await setup("plain-turn");
  expect(env.source.sessions()).toStrictEqual<AgentSession[]>([
    {
      sessionId: id("1"),
      source: "transcripts",
      projectId: path.join(env.REPO, ".git"),
      projectName: path.basename(env.REPO),
      cwd: env.REPO,
      model: "claude-opus-5-5",
      isMain: true,
      state: "standby",
      runningSubagents: 0,
      stateSince: T("10:00:03"),
      lastActivity: T("10:00:07"),
    },
  ]);
  expect(env.source.issues()).toEqual([]);
});

test("each scenario gives its documented state, subagents, main flag and activity", async () => {
  const table: [string, string, Partial<AgentSession>][] = [
    ["tool-calls", id("2"), { state: "working", runningSubagents: 0, isMain: true, lastActivity: T("10:01:01") }],
    ["foreground-subagent", id("3"), { state: "working", runningSubagents: 1, isMain: true, lastActivity: T("10:00:04") }],
    ["background-subagents", id("4"), { state: "working", runningSubagents: 1, isMain: true, lastActivity: T("10:02:06") }],
    ["interrupted", id("5"), { state: "standby", runningSubagents: 0, isMain: true, lastActivity: T("10:00:03") }],
    ["two-worktrees", id("8"), { state: "standby", runningSubagents: 0, isMain: true, lastActivity: T("10:02:00") }],
  ];
  for (const [scenario, sid, expected] of table) {
    const env = await setup(scenario);
    expect(bySession(env, sid)).toMatchObject(expected);
  }
});

test("two-worktrees: both sessions share one projectId", async () => {
  const env = await setup("two-worktrees");
  const all = env.source.sessions();
  expect(all).toHaveLength(2);
  expect(all.map((s) => s.cwd).sort()).toEqual([env.REPO, env.WORKTREE].sort());
  expect(all[0]!.projectId).toBe(path.join(env.REPO, ".git"));
  expect(all[1]!.projectId).toBe(all[0]!.projectId);
  expect(bySession(env, id("7"))).toMatchObject({ state: "working", isMain: true, model: "claude-opus-5-5", lastActivity: T("10:05:00") });
});

test("non-main: sessions are not main and the project is outside git", async () => {
  const env = await setup("non-main");
  const all = env.source.sessions();
  expect(all).toHaveLength(2);
  expect(all.every((s) => !s.isMain && s.model === "claude-sonnet-5-5")).toBe(true);
  expect(all.every((s) => s.projectId === env.PLAIN)).toBe(true);
});

test("subagent files never appear as sessions", async () => {
  const env = await setup("background-subagents");
  expect(env.source.sessions().map((s) => s.sessionId)).toEqual([id("4")]);
});

test("malformed: issues are recorded, partial line completes later", async () => {
  const env = await setup("malformed");
  const issues = env.source.issues();
  expect(issues.map((i) => i.reason)).toEqual(["invalid-json", "not-an-object", "missing-field"]);
  expect(issues[0]!.offset).toBeLessThan(issues[1]!.offset);
  expect(issues[1]!.offset).toBeLessThan(issues[2]!.offset);
  expect(issues.every((i) => i.file === fileOf(env.root, ".jsonl"))).toBe(true);
  const s = bySession(env, id("9"));
  expect(s.state).toBe("standby");
  expect(s.lastActivity).toBe(T("10:00:03"));
  expect(s.cwd).toBe(env.MISSING);
  expect(s.projectId).toBe(env.MISSING);
  expect(s.projectName).toBe("gone");

  appendRaw(fileOf(env.root, ".jsonl"), "\n");
  await env.source.refresh();
  expect(bySession(env, id("9")).state).toBe("working");
  expect(env.source.issues()).toHaveLength(3);
});

test("session-added is emitted once per session before start resolves", async () => {
  const env = await setup("two-worktrees");
  const added = env.events.filter((e) => e.type === "session-added");
  expect(added).toHaveLength(2);
  expect(env.events).toHaveLength(2);
  await env.source.refresh();
  expect(env.events).toHaveLength(2);
});

test("a prompt emits one standby to working with the appended timestamp", async () => {
  const env = await setup("plain-turn");
  const file = fileOf(env.root, ".jsonl");
  appendLine(file, prompt(id("1"), env.REPO, "11:00:00"));
  env.events.length = 0;
  await env.source.refresh();
  const changes = stateChanges(env.events);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    sessionId: id("1"),
    from: "standby",
    to: "working",
    at: T("11:00:00"),
  });
  expect(changes[0]!.session.state).toBe("working");
  expect(bySession(env, id("1")).stateSince).toBe(T("11:00:00"));
});

test("a prompt and a final in one append emit two state changes in order", async () => {
  const env = await setup("plain-turn");
  const file = fileOf(env.root, ".jsonl");
  appendLine(file, prompt(id("1"), env.REPO, "11:00:00"));
  appendLine(file, final(id("1"), env.REPO, "11:00:05"));
  env.events.length = 0;
  await env.source.refresh();
  expect(stateChanges(env.events).map((e) => [e.from, e.to, e.at])).toEqual([
    ["standby", "working", T("11:00:00")],
    ["working", "standby", T("11:00:05")],
  ]);
});

test("an other line emits no state change", async () => {
  const env = await setup("plain-turn");
  appendLine(fileOf(env.root, ".jsonl"), other(id("1"), env.REPO, "11:00:00"));
  env.events.length = 0;
  await env.source.refresh();
  expect(stateChanges(env.events)).toEqual([]);
  expect(bySession(env, id("1")).lastActivity).toBe(T("11:00:00"));
});

test("background subagents: finishing one standbys the session, resuming works it again", async () => {
  const env = await setup("background-subagents");
  const sub = fileOf(env.root, "agent-a0000000000000003.jsonl");
  const line = (at: string, message: object) =>
    JSON.stringify({
      type: "assistant",
      timestamp: T(at),
      sessionId: id("4"),
      cwd: env.REPO,
      isSidechain: true,
      agentId: "a0000000000000003",
      message: { id: "z", model: "claude-sonnet-5-5", ...message },
    });
  appendLine(sub, line("10:30:00", { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] }));
  env.events.length = 0;
  await env.source.refresh();
  let changes = stateChanges(env.events);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ from: "working", to: "standby", at: T("10:30:00") });
  expect(changes[0]!.session.runningSubagents).toBe(0);

  appendLine(sub, line("10:31:00", { stop_reason: "tool_use", content: [{ type: "tool_use", id: "r1", name: "Read", input: {} }] }));
  env.events.length = 0;
  await env.source.refresh();
  changes = stateChanges(env.events);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ from: "standby", to: "working", at: T("10:31:00") });
  expect(changes[0]!.session.runningSubagents).toBe(1);
});

test("a subagent count change without a state change emits session-updated", async () => {
  const env = await setup("foreground-subagent");
  const dir = path.dirname(fileOf(env.root, "agent-a0000000000000001.jsonl"));
  writeFileSync(
    path.join(dir, "agent-a0000000000000009.jsonl"),
    prompt(id("3"), env.REPO, "10:10:00") + "\n",
  );
  env.events.length = 0;
  await env.source.refresh();
  expect(stateChanges(env.events)).toEqual([]);
  const updated = env.events.filter((e) => e.type === "session-updated");
  expect(updated).toHaveLength(1);
  expect(updated[0]!.type === "session-updated" && updated[0]!.session.runningSubagents).toBe(2);
});

test("new session files and new project folders appear after refresh", async () => {
  const env = await setup("plain-turn");
  expect(env.source.sessions()).toHaveLength(1);
  const folder = path.join(env.root, "-newproj");
  mkdirSync(folder);
  const sid = id("a");
  writeFileSync(path.join(folder, `${sid}.jsonl`), prompt(sid, env.PLAIN, "12:00:00") + "\n");
  env.events.length = 0;
  await env.source.refresh();
  expect(env.source.sessions().map((s) => s.sessionId).sort()).toEqual([id("1"), sid].sort());
  expect(env.events.filter((e) => e.type === "session-added")).toHaveLength(1);
});

test("a missing root yields nothing, then sessions once it exists", async () => {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), "av-root-")));
  trackTempDir(base);
  const root = path.join(base, "projects");
  const source = createTranscriptSource({ root, mainAgentPattern: pattern, pollIntervalMs: 0 });
  sources.push(source);
  await source.start();
  expect(source.sessions()).toEqual([]);
  expect(source.issues()).toEqual([]);
  mkdirSync(path.join(root, "-p"), { recursive: true });
  writeFileSync(path.join(root, "-p", `${id("b")}.jsonl`), prompt(id("b"), base, "12:00:00") + "\n");
  await source.refresh();
  expect(source.sessions().map((s) => s.sessionId)).toEqual([id("b")]);
});

test("truncation rebuilds the session with one state change", async () => {
  const env = await setup("plain-turn");
  const file = fileOf(env.root, ".jsonl");
  const first = await Bun.file(file).text();
  const firstPrompt = first.split("\n").find((l) => l.includes("Add a test"))!;
  writeFileSync(file, firstPrompt + "\n");
  env.events.length = 0;
  await env.source.refresh();
  const changes = stateChanges(env.events);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ from: "standby", to: "working" });
  expect(bySession(env, id("1")).state).toBe("working");
});

test("duplicate session ids report only the file with the latest activity", async () => {
  const env = await setup("plain-turn");
  const file = fileOf(env.root, ".jsonl");
  const other2 = path.join(env.root, "-copy");
  mkdirSync(other2);
  const copy = path.join(other2, "copy-of-session.jsonl");
  copyFileSync(file, copy);
  appendLine(copy, prompt(id("1"), env.REPO, "13:00:00"));
  env.events.length = 0;
  await env.source.refresh();
  const all = env.source.sessions();
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({ sessionId: id("1"), state: "working", lastActivity: T("13:00:00") });
  expect(env.events.filter((e) => e.type === "session-added")).toHaveLength(0);
});

test("a large file is folded from the start: padding after a task notification does not hide it (R5 reversed)", async () => {
  const env = await setup("background-subagents", { start: false });
  const parent = fileOf(env.root, `${id("4")}.jsonl`);
  const padLine =
    JSON.stringify({ type: "file-history-snapshot", timestamp: T("10:03:00"), pad: "x".repeat(1000) }) + "\n";
  appendRaw(parent, padLine.repeat(3000));
  // A model and a state-bearing entry at the very end, so a last-2-MiB window would find both and
  // never fall back to a full read; only the notification before the padding would be missed.
  appendLine(parent, final(id("4"), env.REPO, "10:03:01"));
  appendLine(parent, prompt(id("4"), env.REPO, "10:03:02"));
  expect(statSync(parent).size).toBeGreaterThan(3 * 1024 * 1024);
  await env.source.start();
  expect(bySession(env, id("4"))).toMatchObject({ runningSubagents: 1 });
});

test("the source never writes into the transcripts root (SC-006)", async () => {
  const env = await setup("background-subagents", { start: false });
  const mtimes = () => files(env.root).map((f) => [f, statSync(f).mtimeMs]);
  const beforeTree = await snapshotTree([env.root]);
  const beforeTimes = mtimes();
  await env.source.start();
  await env.source.refresh();
  await env.source.stop();
  expect(await snapshotTree([env.root])).toEqual(beforeTree);
  expect(mtimes()).toEqual(beforeTimes);
});

test("after stop, appends and refresh emit nothing; unsubscribed listeners get nothing", async () => {
  const env = await setup("plain-turn");
  const seen: AgentSourceEvent[] = [];
  const off = env.source.subscribe((e) => seen.push(e));
  appendLine(fileOf(env.root, ".jsonl"), prompt(id("1"), env.REPO, "11:00:00"));
  await env.source.refresh();
  expect(seen).toHaveLength(1);
  off();
  appendLine(fileOf(env.root, ".jsonl"), final(id("1"), env.REPO, "11:00:01"));
  await env.source.refresh();
  expect(seen).toHaveLength(1);

  await env.source.stop();
  await env.source.stop();
  const count = env.events.length;
  appendLine(fileOf(env.root, ".jsonl"), prompt(id("1"), env.REPO, "11:00:02"));
  await env.source.refresh();
  expect(env.events).toHaveLength(count);
});

test("a throwing listener does not stop the others", async () => {
  const env = await setup("plain-turn");
  env.source.subscribe(() => {
    throw new Error("boom");
  });
  appendLine(fileOf(env.root, ".jsonl"), prompt(id("1"), env.REPO, "11:00:00"));
  env.events.length = 0;
  await env.source.refresh();
  expect(stateChanges(env.events)).toHaveLength(1);
});

test("an unreadable file is reported once and does not break other sessions", async () => {
  const env = await setup("plain-turn");
  const bad = path.join(env.root, "-bad", `${id("e")}.jsonl`);
  mkdirSync(path.dirname(bad));
  writeFileSync(bad, prompt(id("e"), env.REPO, "12:00:00") + "\n");
  chmodSync(bad, 0o000);
  await env.source.refresh();
  await env.source.refresh();
  const issues = env.source.issues();
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ file: bad, reason: "unreadable", offset: 0 });
  expect(env.source.sessions().map((s) => s.sessionId)).toEqual([id("1")]);
  chmodSync(bad, 0o644);
  await env.source.refresh();
  expect(env.source.sessions()).toHaveLength(2);
});

test("live polling delivers a state change within 1000 ms (SC-002)", async () => {
  const env = await setup("plain-turn", { pollIntervalMs: 100 });
  let resolve!: () => void;
  const arrived = new Promise<"event">((r) => {
    resolve = () => r("event");
  });
  env.source.subscribe((e) => {
    if (e.type === "state-changed") resolve();
  });
  appendLine(fileOf(env.root, ".jsonl"), prompt(id("1"), env.REPO, "11:00:00"));
  let timeout: ReturnType<typeof setTimeout>;
  const timer = new Promise<"timeout">((r) => {
    timeout = setTimeout(() => r("timeout"), 1000);
  });
  const winner = await Promise.race([arrived, timer]);
  clearTimeout(timeout!);
  expect(winner).toBe("event");
});

test("live-shapes: queued notification closes a subagent, continued-in ends a session", async () => {
  const env = await setup("live-shapes");
  expect(bySession(env, id("a"))).toMatchObject({ state: "working", runningSubagents: 1, isMain: true });
  expect(bySession(env, id("b"))).toMatchObject({ state: "standby", runningSubagents: 0, isMain: true });
});
