import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MAPPED_EVENTS } from "../src/agents/attention/hook-line";
import { buildHookSettings, HOOK_REGISTRATIONS } from "../src/agents/attention/settings";

const REPO = path.resolve(import.meta.dir, "..");
const Q = "AskUserQuestion|ExitPlanMode";
const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

test("registered events equal the mapped events, each once", () => {
  const events = HOOK_REGISTRATIONS.map((r) => r.event);
  expect(new Set(events).size).toBe(events.length);
  expect([...events].sort()).toStrictEqual([...MAPPED_EVENTS].sort());
});

test("only the wait-start events and SessionEnd are synchronous", () => {
  const sync = HOOK_REGISTRATIONS.filter((r) => !r.async)
    .map((r) => r.event)
    .sort();
  expect(sync).toStrictEqual(["Elicitation", "PermissionRequest", "PreToolUse", "SessionEnd"]);
});

test("question-tool events carry the matcher and the others have none", () => {
  for (const r of HOOK_REGISTRATIONS) {
    if (["PreToolUse", "PostToolUse", "PostToolUseFailure"].includes(r.event)) {
      expect(r.matcher).toBe(Q);
    } else {
      expect(r.matcher).toBeUndefined();
    }
  }
});

test("buildHookSettings deep-equals the contract snippet", () => {
  const c = "/opt/bun /repo/hooks/attention-hook.ts";
  const sync = { type: "command", command: c };
  const asyn = { type: "command", command: c, async: true };
  const expected = {
    hooks: {
      PermissionRequest: [{ hooks: [sync] }],
      PreToolUse: [{ matcher: Q, hooks: [sync] }],
      Elicitation: [{ hooks: [sync] }],
      PostToolUse: [{ matcher: Q, hooks: [asyn] }],
      PostToolUseFailure: [{ matcher: Q, hooks: [asyn] }],
      ElicitationResult: [{ hooks: [asyn] }],
      UserPromptSubmit: [{ hooks: [asyn] }],
      Stop: [{ hooks: [asyn] }],
      StopFailure: [{ hooks: [asyn] }],
      SubagentStop: [{ hooks: [asyn] }],
      SessionEnd: [{ hooks: [sync] }],
    },
  };
  expect(buildHookSettings("/opt/bun", "/repo/hooks/attention-hook.ts")).toStrictEqual(expected);
});

test("a path with a space is quoted", () => {
  const s = buildHookSettings("/my tools/bun", "/my repo/hooks/attention-hook.ts");
  for (const entries of Object.values(s.hooks)) {
    expect(entries[0]?.hooks[0]?.command).toBe('"/my tools/bun" "/my repo/hooks/attention-hook.ts"');
  }
});

test("only the path that has a space is quoted", () => {
  const s = buildHookSettings("/opt/bun", "/my repo/hooks/attention-hook.ts");
  expect(s.hooks.Stop?.[0]?.hooks[0]?.command).toBe('/opt/bun "/my repo/hooks/attention-hook.ts"');
});

test("the script prints the settings JSON with absolute paths and writes no file", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "av-hook-settings-"));
  dirs.push(cwd);
  const proc = Bun.spawn([process.execPath, path.join(REPO, "scripts", "hook-settings.ts")], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(code).toBe(0);
  expect(await readdir(cwd)).toStrictEqual([]);
  const parsed = JSON.parse(out) as ReturnType<typeof buildHookSettings>;
  const expected = buildHookSettings(process.execPath, path.join(REPO, "hooks", "attention-hook.ts"));
  expect(parsed).toStrictEqual(JSON.parse(JSON.stringify(expected)));
  const command = parsed.hooks.Stop?.[0]?.hooks[0]?.command ?? "";
  expect(command).toContain(process.execPath);
  expect(command).toContain(path.join(REPO, "hooks", "attention-hook.ts"));
  expect(path.isAbsolute(process.execPath)).toBe(true);
  expect(command.replace(/"$/, "").endsWith("hooks/attention-hook.ts")).toBe(true);
});
