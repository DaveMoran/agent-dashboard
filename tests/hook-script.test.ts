import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stateRoot } from "../src/server/state";

const SCRIPT = path.resolve(import.meta.dir, "..", "hooks", "attention-hook.ts");
const REPO = path.resolve(import.meta.dir, "..");

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop() as string;
    try {
      chmodSync(dir, 0o700);
    } catch {
      // already gone
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "av-hook-"));
  temps.push(dir);
  return dir;
}

type Run = { stdout: string; stderr: string; code: number };

async function runHook(stdin: string, stateDir: string, home: string): Promise<Run> {
  const proc = Bun.spawn([process.execPath, SCRIPT], {
    cwd: REPO,
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, AGENT_VISUALIZER_STATE_DIR: stateDir, HOME: home },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

function expectSilent(run: Run): void {
  expect(run.stdout).toBe("");
  expect(run.stderr).toBe("");
  expect(run.code).toBe(0);
}

function eventsFile(stateDir: string): string {
  return path.join(stateDir, "hooks", "events.jsonl");
}

function readLines(stateDir: string): Record<string, unknown>[] {
  const text = readFileSync(eventsFile(stateDir), "utf8");
  expect(text.endsWith("\n")).toBe(true);
  return text
    .slice(0, -1)
    .split("\n")
    .map((l) => JSON.parse(l));
}

function setup(): { state: string; home: string } {
  return { state: path.join(tempDir(), "state"), home: tempDir() };
}

describe("attention hook script", () => {
  test("PermissionRequest writes exactly one line with only the allowed keys", async () => {
    const { state, home } = setup();
    const before = Date.now();
    const run = await runHook(
      JSON.stringify({
        session_id: "s-1",
        cwd: "/work/repo",
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "rm -rf /secret-command" },
        permission_suggestions: [{ type: "addRules" }],
        prompt_id: "p-9",
      }),
      state,
      home,
    );
    expectSilent(run);
    const text = readFileSync(eventsFile(state), "utf8");
    expect(text).not.toContain("secret-command");
    expect(text).not.toContain("permission_suggestions");
    expect(text).not.toContain("p-9");
    const lines = readLines(state);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(Object.keys(line).sort()).toStrictEqual(["cwd", "event", "session", "ts", "type"]);
    expect(line.session).toBe("s-1");
    expect(line.cwd).toBe("/work/repo");
    expect(line.event).toBe("PermissionRequest");
    expect(line.type).toBe("Bash");
    const ts = Date.parse(line.ts as string);
    expect(Number.isNaN(ts)).toBe(false);
    expect(new Date(ts).toISOString()).toBe(line.ts as string);
    expect(Math.abs(ts - Date.now())).toBeLessThan(5000);
    expect(ts).toBeGreaterThanOrEqual(before - 5000);
  });

  test("cwd is omitted when the input has none", async () => {
    const { state, home } = setup();
    expectSilent(await runHook(JSON.stringify({ session_id: "s", hook_event_name: "Stop" }), state, home));
    const [line] = readLines(state);
    expect(Object.keys(line).sort()).toStrictEqual(["event", "session", "ts"]);
  });

  test("UserPromptSubmit does not leak the prompt and has no type", async () => {
    const { state, home } = setup();
    const run = await runHook(
      JSON.stringify({
        session_id: "s-2",
        cwd: "/w",
        hook_event_name: "UserPromptSubmit",
        prompt: "secret text",
      }),
      state,
      home,
    );
    expectSilent(run);
    const text = readFileSync(eventsFile(state), "utf8");
    expect(text).not.toContain("secret text");
    const [line] = readLines(state);
    expect("type" in line).toBe(false);
    expect(Object.keys(line).sort()).toStrictEqual(["cwd", "event", "session", "ts"]);
  });

  test("Notification message is not written; type comes from notification_type", async () => {
    const { state, home } = setup();
    expectSilent(
      await runHook(
        JSON.stringify({
          session_id: "s",
          hook_event_name: "Elicitation",
          notification_type: "permission_prompt",
          message: "private message body",
          tool_name: "Ignored",
        }),
        state,
        home,
      ),
    );
    expect(readFileSync(eventsFile(state), "utf8")).not.toContain("private message body");
    const [line] = readLines(state);
    expect(line.type).toBe("permission_prompt");
  });

  test("type falls back from tool_name to reason", async () => {
    const { state, home } = setup();
    expectSilent(
      await runHook(
        JSON.stringify({
          session_id: "s",
          hook_event_name: "PreToolUse",
          tool_name: "AskUserQuestion",
          reason: "other",
        }),
        state,
        home,
      ),
    );
    expect(readLines(state)[0].type).toBe("AskUserQuestion");
  });

  test("SessionEnd with reason logout has type logout", async () => {
    const { state, home } = setup();
    expectSilent(
      await runHook(
        JSON.stringify({ session_id: "s", hook_event_name: "SessionEnd", reason: "logout" }),
        state,
        home,
      ),
    );
    const [line] = readLines(state);
    expect(line.event).toBe("SessionEnd");
    expect(line.type).toBe("logout");
  });

  test("a subagent input carries agent from agent_id", async () => {
    const { state, home } = setup();
    expectSilent(
      await runHook(
        JSON.stringify({
          session_id: "s",
          cwd: "/w",
          hook_event_name: "PermissionRequest",
          tool_name: "Write",
          agent_id: "aabcc9e032d23a66b",
        }),
        state,
        home,
      ),
    );
    const [line] = readLines(state);
    expect(line.agent).toBe("aabcc9e032d23a66b");
    expect(Object.keys(line).sort()).toStrictEqual(["agent", "cwd", "event", "session", "ts", "type"]);
  });

  test("a missing state dir is created, and lines append", async () => {
    const { state, home } = setup();
    expect(existsSync(state)).toBe(false);
    const input = JSON.stringify({ session_id: "s", hook_event_name: "Stop" });
    expectSilent(await runHook(input, state, home));
    expectSilent(await runHook(input, state, home));
    expect(readLines(state)).toHaveLength(2);
  });

  test("hooks directory is created with mode 0700", async () => {
    const { state, home } = setup();
    expectSilent(await runHook(JSON.stringify({ session_id: "s", hook_event_name: "Stop" }), state, home));
    const { statSync } = await import("node:fs");
    expect(statSync(path.join(state, "hooks")).mode & 0o777).toBe(0o700);
  });

  test("nothing is written to the real-home default when the env var is set", async () => {
    const { state, home } = setup();
    expectSilent(await runHook(JSON.stringify({ session_id: "s", hook_event_name: "Stop" }), state, home));
    expect(existsSync(path.join(home, ".agent-visualizer"))).toBe(false);
  });

  test("falls back to ~/.agent-visualizer under HOME when the env var is unset", async () => {
    const home = tempDir();
    const env: Record<string, string | undefined> = { ...process.env, HOME: home };
    delete env.AGENT_VISUALIZER_STATE_DIR;
    const proc = Bun.spawn([process.execPath, SCRIPT], {
      cwd: REPO,
      stdin: new Blob([JSON.stringify({ session_id: "s", hook_event_name: "Stop" })]),
      stdout: "pipe",
      stderr: "pipe",
      env: env as Record<string, string>,
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expectSilent({ stdout: out, stderr: err, code });
    expect(existsSync(path.join(home, ".agent-visualizer", "hooks", "events.jsonl"))).toBe(true);
  });

  const nothingCases: [string, string][] = [
    ["invalid JSON", "{not json"],
    ["empty stdin", ""],
    ["a JSON array", "[1,2]"],
    ["JSON null", "null"],
    ["a JSON string", '"hello"'],
    ["no session_id", JSON.stringify({ hook_event_name: "Stop", cwd: "/w" })],
    ["no hook_event_name", JSON.stringify({ session_id: "s" })],
    ["a non-string session_id", JSON.stringify({ session_id: 5, hook_event_name: "Stop" })],
  ];
  for (const [name, input] of nothingCases) {
    test(`${name} writes nothing, silently, exit 0`, async () => {
      const { state, home } = setup();
      expectSilent(await runHook(input, state, home));
      expect(existsSync(eventsFile(state))).toBe(false);
    });
  }

  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  test.skipIf(isRoot)("a read-only state dir writes nothing, silently, exit 0", async () => {
    const parent = tempDir();
    chmodSync(parent, 0o500);
    const state = path.join(parent, "state");
    const run = await runHook(JSON.stringify({ session_id: "s", hook_event_name: "Stop" }), state, tempDir());
    expectSilent(run);
    chmodSync(parent, 0o700);
    expect(existsSync(state)).toBe(false);
  });

  test("10 concurrent spawns give 10 complete parseable lines", async () => {
    const { state, home } = setup();
    const runs = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        runHook(
          JSON.stringify({
            session_id: `sess-${i}`,
            cwd: "/w",
            hook_event_name: "PermissionRequest",
            tool_name: "Bash",
          }),
          state,
          home,
        ),
      ),
    );
    for (const r of runs) expectSilent(r);
    const lines = readLines(state);
    expect(lines).toHaveLength(10);
    expect(lines.map((l) => l.session).sort()).toStrictEqual(
      Array.from({ length: 10 }, (_, i) => `sess-${i}`).sort(),
    );
  });

  test("the written path equals stateRoot()/hooks/events.jsonl for the same env", async () => {
    const { state, home } = setup();
    const saved = process.env.AGENT_VISUALIZER_STATE_DIR;
    process.env.AGENT_VISUALIZER_STATE_DIR = state;
    let expected: string;
    try {
      expected = path.join(stateRoot(), "hooks", "events.jsonl");
    } finally {
      if (saved === undefined) delete process.env.AGENT_VISUALIZER_STATE_DIR;
      else process.env.AGENT_VISUALIZER_STATE_DIR = saved;
    }
    expectSilent(await runHook(JSON.stringify({ session_id: "s", hook_event_name: "Stop" }), state, home));
    expect(expected).toBe(eventsFile(state));
    expect(existsSync(expected)).toBe(true);
  });

  test("the script imports only node:fs, node:os and node:path", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const specifiers = new Set<string>();
    for (const m of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) specifiers.add(m[1]);
    for (const m of source.matchAll(/\bimport\s+["']([^"']+)["']/g)) specifiers.add(m[1]);
    for (const m of source.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g))
      specifiers.add(m[1]);
    expect(specifiers.size).toBeGreaterThan(0);
    for (const s of specifiers) expect(["node:fs", "node:os", "node:path"]).toContain(s);
  });
});
