import { afterEach, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { emptyCopy, materializeAttention, scenarioLines } from "./attention-fixtures";
import { cleanupFixtures, FIXTURES } from "./helpers";

afterEach(cleanupFixtures);

const S01 = "a0050000-0000-0000-0000-000000000001";

test("materializing permission-main replaces {{REPO}} in the copy only", async () => {
  const { dir, transcriptsRoot, eventsFile } = await materializeAttention("permission-main", {
    REPO: "/work/repo",
  });
  expect(transcriptsRoot).toBe(path.join(dir, "projects"));
  expect(eventsFile).toBe(path.join(dir, "events.jsonl"));
  const transcript = readFileSync(path.join(transcriptsRoot, "-repo", `${S01}.jsonl`), "utf8");
  expect(transcript).toContain('"cwd":"/work/repo"');
  expect(transcript).not.toContain("{{REPO}}");
  expect(readFileSync(eventsFile, "utf8")).toContain('"cwd":"/work/repo"');
  const original = readFileSync(
    path.join(FIXTURES, "attention", "permission-main", "projects", "-repo", `${S01}.jsonl`),
    "utf8",
  );
  expect(original).toContain("{{REPO}}");
});

test("a missing placeholder value rejects", async () => {
  await expect(materializeAttention("permission-main", {})).rejects.toThrow(/REPO/);
});

test("scenarioLines returns the 6 lines of permission-main in timestamp order", async () => {
  const { dir, eventsFile } = await materializeAttention("permission-main", { REPO: "/r" });
  const lines = scenarioLines(dir);
  expect(lines.map((l) => l.ts)).toStrictEqual([
    "2026-10-15T10:00:00.000Z",
    "2026-10-15T10:00:01.000Z",
    "2026-10-15T10:00:02.000Z",
    "2026-10-15T10:00:10.000Z",
    "2026-10-15T10:00:11.000Z",
    "2026-10-15T10:00:11.500Z",
  ]);
  expect(lines[2]!.file).toBe(eventsFile);
  expect(JSON.parse(lines[2]!.text)).toStrictEqual({
    ts: "2026-10-15T10:00:02.000Z",
    session: S01,
    cwd: "/r",
    event: "PermissionRequest",
    type: "Bash",
  });
  for (const i of [0, 1, 3, 4, 5]) expect(lines[i]!.file).not.toBe(eventsFile);
});

test("scenarioLines includes subagent transcripts", async () => {
  const { dir } = await materializeAttention("subagent-wait", { REPO: "/r" });
  const lines = scenarioLines(dir);
  expect(lines).toHaveLength(5 + 8 + 4 + 3);
  const ts = lines.map((l) => l.ts);
  expect(ts).toStrictEqual([...ts].sort());
});

test("emptyCopy leaves every file at 0 bytes", async () => {
  const { dir } = await materializeAttention("subagent-wait", { REPO: "/r" });
  emptyCopy(dir);
  const sizes: number[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else sizes.push(statSync(p).size);
    }
  };
  walk(dir);
  expect(sizes).toHaveLength(4);
  expect(sizes.every((s) => s === 0)).toBe(true);
  expect(scenarioLines(dir)).toStrictEqual([]);
});

test("the checked-in fixtures are unchanged by materializing", async () => {
  const eventsPath = path.join(FIXTURES, "attention", "permission-main", "events.jsonl");
  const before = readFileSync(eventsPath, "utf8");
  const { dir } = await materializeAttention("permission-main", { REPO: "/r" });
  emptyCopy(dir);
  expect(readFileSync(eventsPath, "utf8")).toBe(before);
  expect(before).toContain("{{REPO}}");
});

test("malformed-events ends without a trailing newline", () => {
  const text = readFileSync(path.join(FIXTURES, "attention", "malformed-events", "events.jsonl"), "utf8");
  expect(text.endsWith("\n")).toBe(false);
  expect(text.split("\n")).toHaveLength(6);
});
