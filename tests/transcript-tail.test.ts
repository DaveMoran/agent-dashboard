import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTail } from "../src/agents/transcripts/tail";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tail-test-"));
  file = join(dir, "t.jsonl");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("FileTail", () => {
  test("two appends read only new lines with exact offsets", async () => {
    const tail = new FileTail(file);
    writeFileSync(file, "aa\nbbb\n");
    const r1 = await tail.read();
    expect(r1.lines).toEqual([
      { text: "aa", offset: 0 },
      { text: "bbb", offset: 3 },
    ]);
    expect(r1.reset).toBe(false);
    expect(r1.changed).toBe(true);
    appendFileSync(file, "cccc\n");
    const r2 = await tail.read();
    expect(r2.lines).toEqual([{ text: "cccc", offset: 7 }]);
    expect(r2.bytesRead).toBe(5);
  });

  test("a partial line is held back and emitted once when completed", async () => {
    const tail = new FileTail(file);
    writeFileSync(file, "one\ntw");
    expect((await tail.read()).lines).toEqual([{ text: "one", offset: 0 }]);
    appendFileSync(file, "o\n");
    expect((await tail.read()).lines).toEqual([{ text: "two", offset: 4 }]);
    expect((await tail.read()).lines).toEqual([]);
  });

  test("a multi-byte character split across appends decodes correctly", async () => {
    const tail = new FileTail(file);
    const bytes = new TextEncoder().encode("a€b\n");
    expect(bytes.length).toBe(6);
    writeFileSync(file, bytes.slice(0, 3)); // "a" + first byte of "€"... plus one more
    expect((await tail.read()).lines).toEqual([]);
    appendFileSync(file, bytes.slice(3));
    const r = await tail.read();
    expect(r.lines).toEqual([{ text: "a€b", offset: 0 }]);
  });

  test("a € cut after its first byte decodes correctly", async () => {
    const tail = new FileTail(file);
    const bytes = new TextEncoder().encode("x€\ny\n");
    writeFileSync(file, bytes.slice(0, 2));
    await tail.read();
    appendFileSync(file, bytes.slice(2));
    const r = await tail.read();
    expect(r.lines.map((l) => l.text)).toEqual(["x€", "y"]);
    expect(r.lines[1]!.offset).toBe(5);
  });

  test("truncation resets and returns the new content", async () => {
    const tail = new FileTail(file);
    writeFileSync(file, "long line one\nlong line two\n");
    await tail.read();
    writeFileSync(file, "new\n");
    const r = await tail.read();
    expect(r.reset).toBe(true);
    expect(r.lines).toEqual([{ text: "new", offset: 0 }]);
  });

  test("an unchanged file reports changed false and reads nothing", async () => {
    const tail = new FileTail(file);
    writeFileSync(file, "a\n");
    await tail.read();
    const r = await tail.read();
    expect(r).toEqual({ lines: [], reset: false, bytesRead: 0, changed: false });
  });

  test("a missing file rejects with unreadable:", async () => {
    const tail = new FileTail(join(dir, "missing.jsonl"));
    await expect(tail.read()).rejects.toThrow(/^unreadable:/);
  });

  test("strips CR and skips empty lines", async () => {
    const tail = new FileTail(file);
    writeFileSync(file, "a\r\n\nb\n");
    const r = await tail.read();
    expect(r.lines).toEqual([
      { text: "a", offset: 0 },
      { text: "b", offset: 4 },
    ]);
  });

  test("reads leave file bytes and mtime unchanged", async () => {
    writeFileSync(file, "a\nb\n");
    const before = statSync(file).mtimeMs;
    const content = readFileSync(file);
    const tail = new FileTail(file);
    await tail.read();
    await tail.read();
    expect(statSync(file).mtimeMs).toBe(before);
    expect(readFileSync(file).equals(content)).toBe(true);
  });
});
