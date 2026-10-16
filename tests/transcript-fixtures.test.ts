import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanupFixtures, FIXTURES } from "./helpers";
import { appendLine, appendRaw, materializeTranscripts } from "./transcript-fixtures";

afterEach(cleanupFixtures);

const REL = path.join("p", "00000000-0000-0000-0000-000000000000.jsonl");

test("placeholders are replaced in the copy only", async () => {
  const root = await materializeTranscripts("_helper", { PLAIN: "/x" });
  expect(readFileSync(path.join(root, REL), "utf8")).toContain('"cwd":"/x"');
  const original = readFileSync(path.join(FIXTURES, "transcripts", "_helper", REL), "utf8");
  expect(original).toContain("{{PLAIN}}");
});

test("a missing placeholder value rejects", async () => {
  await expect(materializeTranscripts("_helper", {})).rejects.toThrow(/PLAIN/);
});

test("appendLine adds a newline, appendRaw does not", async () => {
  const root = await materializeTranscripts("_helper", { PLAIN: "/x" });
  const f = path.join(root, REL);
  const base = readFileSync(f, "utf8");
  appendLine(f, "a");
  appendRaw(f, "b");
  expect(readFileSync(f, "utf8")).toBe(`${base}a\nb`);
});
