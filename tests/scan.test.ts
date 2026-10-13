import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createStubAdapter } from "../fixtures/stub/adapter";
import { scan } from "../src/core/scan";
import { cleanupFixtures, copyFixture, FIXTURES } from "./helpers";

const repoA = path.join(FIXTURES, "stub", "repo-a");
const repoB = path.join(FIXTURES, "stub", "repo-b");

afterEach(cleanupFixtures);

async function okSnapshot(result: Awaited<ReturnType<typeof scan>>) {
  if (!result.ok) throw new Error(`scan failed: ${result.error.message}`);
  return result.snapshot;
}

describe("scan", () => {
  test("repo-a gives specs 001, 002, 003 in order with all fields preserved", async () => {
    const snap = await okSnapshot(await scan(createStubAdapter(), { roots: [repoA] }));
    expect(snap.adapter).toBe("stub");
    expect(snap.issues).toEqual([]);
    expect(snap.specs.map((s) => s.id)).toEqual(["001", "002", "003"]);
    expect(Number.isNaN(Date.parse(snap.scannedAt))).toBe(false);

    expect(snap.specs[0]).toEqual({
      id: "001",
      title: "First",
      status: "drafted",
      dependsOn: [],
      tasks: [],
      artifacts: [],
      source: { root: repoA },
    });
    expect(snap.specs[1]).toEqual({
      id: "002",
      title: "Second",
      status: "planned",
      dependsOn: ["001"],
      tasks: [
        { id: "T1", text: "Do a", done: true, phase: "Setup" },
        { id: "T2", text: "Do b", done: false, parallel: true },
        { id: "T3", text: "Do c", done: false },
      ],
      artifacts: ["stub-specs/002.json"],
      branch: "002-second",
      source: { root: repoA },
    });
    expect("extra" in snap.specs[1]!).toBe(false);
    expect("phase" in snap.specs[1]!.tasks[1]!).toBe(false);
    expect("parallel" in snap.specs[1]!.tasks[0]!).toBe(false);
  });

  test("two roots combine, with source.root identifying each", async () => {
    const snap = await okSnapshot(
      await scan(createStubAdapter(), { roots: [repoA, repoB] }),
    );
    expect(snap.specs.map((s) => s.id).sort()).toEqual(["001", "002", "003", "004"]);
    expect(snap.specs.find((s) => s.id === "004")!.source).toEqual({ root: repoB });
    expect(snap.specs.find((s) => s.id === "001")!.source).toEqual({ root: repoA });
  });

  test("the same unreadable root listed twice is reported once", async () => {
    const missing = path.join(FIXTURES, "stub", "does-not-exist");
    const snap = await okSnapshot(
      await scan(createStubAdapter(), { roots: [missing, missing] }),
    );
    expect(snap.issues).toHaveLength(1);
    expect(snap.issues[0]!.kind).toBe("unreadable-path");
  });

  test("null adapter gives an empty snapshot", async () => {
    const snap = await okSnapshot(await scan(null, { roots: [repoA] }));
    expect(snap.specs).toEqual([]);
    expect(snap.issues).toEqual([]);
    expect(snap.adapter).toBeNull();
  });

  test("discover throwing gives ok:false at stage discover", async () => {
    const adapter = {
      ...createStubAdapter(),
      discover: async () => {
        throw new Error("boom in discover");
      },
    };
    const result = await scan(adapter, { roots: [repoA] });
    expect(result).toEqual({
      ok: false,
      error: { stage: "discover", message: "boom in discover" },
    });
  });

  test("parse throwing gives ok:false at stage parse", async () => {
    const root = await copyFixture("stub/repo-a");
    await writeFile(path.join(root, "stub-specs", "001.json"), "FAIL");
    const result = await scan(createStubAdapter(), { roots: [root] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.stage).toBe("parse");
      expect(result.error.message).toContain("stub parse failure");
    }
  });

  test("files under node_modules/ and .git/ are never matched", async () => {
    const root = await copyFixture("stub/repo-a");
    const bad = '{"id":"9","title":"Nope","status":"drafted"}';
    await mkdir(path.join(root, "node_modules", "x", "stub-specs"), { recursive: true });
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "x", "stub-specs", "9.json"), bad);
    await writeFile(path.join(root, ".git", "9.json"), bad);
    const adapter = createStubAdapter({ patterns: ["**/*.json"] });
    const snap = await okSnapshot(await scan(adapter, { roots: [root] }));
    expect(snap.specs.map((s) => s.id)).toEqual(["001", "002", "003"]);
  });

  test.skipIf(process.getuid?.() === 0)(
    "an unreadable root adds unreadable-path and the scan still succeeds",
    async () => {
      const root = await copyFixture("stub/repo-a");
      await chmod(root, 0o000);
      try {
        const snap = await okSnapshot(await scan(createStubAdapter(), { roots: [root] }));
        expect(snap.specs).toEqual([]);
        expect(snap.issues).toHaveLength(1);
        expect(snap.issues[0]!.kind).toBe("unreadable-path");
        expect(snap.issues[0]!.message).toContain(root);
      } finally {
        await chmod(root, 0o755);
      }
    },
  );

  test.skipIf(process.getuid?.() === 0)(
    "an unreadable subfolder is skipped individually and named in one issue",
    async () => {
      const root = await copyFixture("stub/repo-a");
      const locked = path.join(root, "locked");
      await mkdir(locked);
      await chmod(locked, 0o000);
      try {
        const adapter = createStubAdapter({ patterns: ["**/*.json"] });
        const snap = await okSnapshot(await scan(adapter, { roots: [root] }));
        expect(snap.specs.map((s) => s.id)).toEqual(["001", "002", "003"]);
        expect(snap.issues).toHaveLength(1);
        expect(snap.issues[0]!.kind).toBe("unreadable-path");
        expect(snap.issues[0]!.message).toContain(locked);
      } finally {
        await chmod(locked, 0o755);
      }
    },
  );

  test.skipIf(process.getuid?.() === 0)(
    "an unreadable folder inside node_modules is pruned, so it produces no issue",
    async () => {
      const root = await copyFixture("stub/repo-a");
      const locked = path.join(root, "node_modules", "locked");
      await mkdir(locked, { recursive: true });
      await chmod(locked, 0o000);
      try {
        const adapter = createStubAdapter({ patterns: ["**/*.json"] });
        const snap = await okSnapshot(await scan(adapter, { roots: [root] }));
        expect(snap.specs.map((s) => s.id)).toEqual(["001", "002", "003"]);
        expect(snap.issues).toEqual([]);
      } finally {
        await chmod(locked, 0o755);
      }
    },
  );
});
