import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  listSessionFiles,
  listSubagentFiles,
  transcriptsRoot,
} from "../src/agents/transcripts/discover";

let tmp: string;
let root: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "av-discover-"));
  root = path.join(tmp, "projects");
  const a = path.join(root, "-proj-a");
  const b = path.join(root, "-proj-b");
  await mkdir(path.join(a, "s1", "subagents"), { recursive: true });
  await mkdir(path.join(a, "s1", "tool-results"), { recursive: true });
  await mkdir(path.join(a, "x.jsonl"), { recursive: true });
  await mkdir(b, { recursive: true });
  await writeFile(path.join(a, "s1.jsonl"), "");
  await writeFile(path.join(a, "s2.jsonl"), "");
  await writeFile(path.join(b, "s3.jsonl"), "");
  await writeFile(path.join(a, "notes.txt"), "");
  await writeFile(path.join(root, "top.jsonl"), "");
  await writeFile(path.join(a, "s1", "subagents", "agent-a1.jsonl"), "");
  await writeFile(path.join(a, "s1", "subagents", "agent-a1.meta.json"), "{}");
  await writeFile(path.join(a, "s1", "subagents", "agent-a0.jsonl"), "");
  await writeFile(path.join(a, "s1", "subagents", "other.jsonl"), "");
  await writeFile(path.join(a, "s1", "tool-results", "x.jsonl"), "");
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("listSessionFiles", () => {
  test("returns only two-level jsonl files, sorted", async () => {
    expect(await listSessionFiles(root)).toEqual([
      path.join(root, "-proj-a", "s1.jsonl"),
      path.join(root, "-proj-a", "s2.jsonl"),
      path.join(root, "-proj-b", "s3.jsonl"),
    ]);
  });

  test("missing root or file root gives []", async () => {
    expect(await listSessionFiles(path.join(tmp, "nope"))).toEqual([]);
    expect(await listSessionFiles(path.join(root, "top.jsonl"))).toEqual([]);
  });
});

describe("listSubagentFiles", () => {
  test("lists agent files sorted by id, ignoring meta and others", async () => {
    const dir = path.join(root, "-proj-a", "s1", "subagents");
    expect(await listSubagentFiles(path.join(root, "-proj-a", "s1.jsonl"))).toEqual([
      { agentId: "a0", path: path.join(dir, "agent-a0.jsonl") },
      { agentId: "a1", path: path.join(dir, "agent-a1.jsonl") },
    ]);
  });

  test("missing folder gives []", async () => {
    expect(await listSubagentFiles(path.join(root, "-proj-a", "s2.jsonl"))).toEqual([]);
  });
});

describe("transcriptsRoot", () => {
  const home = os.homedir();
  test("env wins", () => {
    expect(transcriptsRoot("/c", "/cfg", { AGENT_VISUALIZER_TRANSCRIPTS_DIR: "/env" })).toBe("/env");
  });
  test("empty env falls to config", () => {
    expect(transcriptsRoot("/c", "/cfg", { AGENT_VISUALIZER_TRANSCRIPTS_DIR: "" })).toBe("/cfg");
  });
  test("default", () => {
    expect(transcriptsRoot(undefined, undefined, {})).toBe(path.join(home, ".claude", "projects"));
  });
  test("~/ expansion", () => {
    expect(transcriptsRoot("/c", "~/t", {})).toBe(path.join(home, "t"));
  });
  test("relative resolves against configDir", () => {
    expect(transcriptsRoot("/c/d", "t/x", {})).toBe("/c/d/t/x");
  });
});
