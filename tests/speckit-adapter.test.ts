import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { adapters } from "../src/adapters";
import { speckitAdapter } from "../src/adapters/speckit";
import { assertKnownAdapter, createRegistry, selectAdapter } from "../src/core/registry";
import { scan } from "../src/core/scan";
import type { Snapshot } from "../src/core/model";
import { cleanupFixtures, copyFixture, trackTempDir } from "./helpers";

afterEach(cleanupFixtures);

async function scanOk(dir: string): Promise<Snapshot> {
  const result = await scan(speckitAdapter, { roots: [dir] });
  if (!result.ok) throw new Error(`scan failed: ${result.error.message}`);
  return result.snapshot;
}

async function write(dir: string, rel: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), text);
}

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "av-empty-")));
  trackTempDir(dir);
  return dir;
}

describe("speckit adapter on the fixture repo", () => {
  test("finds every feature directory with a spec.md", async () => {
    const snap = await scanOk(await copyFixture("speckit/repo"));
    expect(snap.adapter).toBe("speckit");
    expect(snap.specs.map((s) => s.id)).toStrictEqual(["001", "002", "003", "004", "005", "006", "007", "008"]);
  });

  test("derives each status from files alone", async () => {
    const snap = await scanOk(await copyFixture("speckit/repo"));
    expect(Object.fromEntries(snap.specs.map((s) => [s.id, s.status]))).toStrictEqual({
      "001": "drafted",
      "002": "planned",
      "003": "ready",
      "004": "in-progress",
      "005": "review",
      "006": "ready",
      "007": "in-progress",
      "008": "drafted",
    });
  });

  test("spec 004 has every field", async () => {
    const dir = await copyFixture("speckit/repo");
    const spec = (await scanOk(dir)).specs.find((s) => s.id === "004");
    expect(spec).toStrictEqual({
      id: "004",
      title: "In Progress",
      status: "in-progress",
      dependsOn: [],
      tasks: [
        { id: "T001", text: "Set up", done: true, phase: "Phase 1: Setup" },
        { id: "T002", text: "Add config", done: true, phase: "Phase 1: Setup", parallel: true },
        { id: "T003", text: "Build it", done: false, phase: "Phase 2: Build" },
        { id: "T004", text: "Test it", done: false, phase: "Phase 2: Build", parallel: true },
        { id: "T005", text: "Document it", done: false, phase: "Phase 2: Build" },
      ],
      artifacts: [
        "specs/004-in-progress/checklists/requirements.md",
        "specs/004-in-progress/contracts/api.md",
        "specs/004-in-progress/plan.md",
        "specs/004-in-progress/spec.md",
        "specs/004-in-progress/tasks.md",
      ],
      branch: "004-in-progress",
      source: { root: dir },
    });
  });

  test("titles: heading without prefix is used; missing heading falls back to id with an issue", async () => {
    const snap = await scanOk(await copyFixture("speckit/repo"));
    expect(snap.specs.find((s) => s.id === "007")!.title).toBe("No Plan Here");
    expect(snap.specs.find((s) => s.id === "008")!.title).toBe("008");
    const issue = snap.issues.find((i) => i.kind === "missing-title");
    expect(issue?.specId).toBe("008");
  });

  test("two directories with the same number give a duplicate-id issue", async () => {
    const dir = await copyFixture("speckit/repo");
    await write(dir, "specs/007-b/spec.md", "# Feature Specification: B\n");
    const snap = await scanOk(dir);
    const issue = snap.issues.find((i) => i.kind === "duplicate-id");
    expect(issue?.specId).toBe("007");
  });

  test("tasks without a plan are still review when all are ticked", async () => {
    const dir = await copyFixture("speckit/repo");
    await rm(path.join(dir, "specs/005-review/plan.md"));
    const spec = (await scanOk(dir)).specs.find((s) => s.id === "005");
    expect(spec!.status).toBe("review");
  });

  test("discover watches specs/*/** in every root", async () => {
    const dir = await copyFixture("speckit/repo");
    expect(await speckitAdapter.discover({ roots: [dir] })).toStrictEqual([
      { root: dir, patterns: ["specs/*/**"] },
    ]);
  });

  test("is registered and selected by name", async () => {
    const dir = await copyFixture("speckit/repo");
    const registry = createRegistry(adapters);
    const selection = await selectAdapter(registry, { roots: [dir] });
    expect(selection.adapter?.name).toBe("speckit");
    expect(() => assertKnownAdapter("speckit", registry)).not.toThrow();
  });
});

describe("speckit detect", () => {
  test("true for the fixture repo", async () => {
    expect(await speckitAdapter.detect({ roots: [await copyFixture("speckit/repo")] })).toBe(true);
  });

  test("true for a folder with only .specify/", async () => {
    const dir = await tempDir();
    await mkdir(path.join(dir, ".specify"));
    expect(await speckitAdapter.detect({ roots: [dir] })).toBe(true);
  });

  test("false for an empty folder", async () => {
    expect(await speckitAdapter.detect({ roots: [await tempDir()] })).toBe(false);
  });

  test("false when the directory name has fewer than three digits", async () => {
    const dir = await tempDir();
    await write(dir, "specs/12-x/spec.md", "# X\n");
    expect(await speckitAdapter.detect({ roots: [dir] })).toBe(false);
  });

  test("false when the feature directory has no spec.md", async () => {
    const dir = await tempDir();
    await write(dir, "specs/003-x/plan.md", "# Plan\n");
    expect(await speckitAdapter.detect({ roots: [dir] })).toBe(false);
  });
});
