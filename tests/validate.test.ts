import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createStubAdapter } from "../fixtures/stub/adapter";
import type { Issue } from "../src/core/model";
import { scan } from "../src/core/scan";
import { findCycles, validateSpecs } from "../src/core/validate";
import { FIXTURES } from "./helpers";

const invalidRoot = path.join(FIXTURES, "stub", "invalid");

async function load(...names: string[]): Promise<unknown[]> {
  return Promise.all(
    names.map(async (n) =>
      JSON.parse(await readFile(path.join(invalidRoot, "stub-specs", `${n}.json`), "utf8")),
    ),
  );
}

describe("validateSpecs: one test per issue kind", () => {
  test("invalid-shape: not an object", () => {
    // not-object.json is `[1,2]`
    return load("not-object").then(([raw]) => {
      const { specs, issues } = validateSpecs([raw]);
      expect(specs).toEqual([]);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("invalid-shape");
      expect(issues[0]!.message).toContain("[1,2]");
    });
  });

  test("invalid-shape: missing id drops the spec", async () => {
    const { specs, issues } = validateSpecs(await load("no-id"));
    expect(specs).toEqual([]);
    expect(issues.map((i) => i.kind)).toEqual(["invalid-shape"]);
    expect(issues[0]!.specId).toBeUndefined();
  });

  test("invalid-shape: non-string dependsOn entries are dropped, spec kept", () => {
    const { specs, issues } = validateSpecs([
      { id: "A", title: "A", status: "drafted", dependsOn: ["B", 7] },
      { id: "B", title: "B", status: "drafted" },
    ]);
    expect(specs.map((s) => s.id)).toEqual(["A", "B"]);
    expect(specs[0]!.dependsOn).toEqual(["B"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "invalid-shape", specId: "A" });
  });

  test("missing-title: kept with title = id", async () => {
    const { specs, issues } = validateSpecs(await load("no-title"));
    expect(specs.map((s) => [s.id, s.title])).toEqual([["T", "T"]]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "missing-title", specId: "T" });
  });

  test("invalid-status: spec excluded", async () => {
    const { specs, issues } = validateSpecs(await load("bad-status"));
    expect(specs).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "invalid-status", specId: "BS" });
    expect(issues[0]!.message).toContain("almost-done");
  });

  test("invalid-task: task dropped, spec kept", async () => {
    const { specs, issues } = validateSpecs(await load("bad-task"));
    expect(specs.map((s) => s.id)).toEqual(["BT"]);
    expect(specs[0]!.tasks.map((t) => t.id)).toEqual(["T2"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "invalid-task", specId: "BT", taskId: "T1" });
  });

  test("duplicate-task-id: both tasks kept", async () => {
    const { specs, issues } = validateSpecs(await load("dup-task"));
    expect(specs[0]!.tasks.map((t) => t.text)).toEqual(["one", "two"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "duplicate-task-id", specId: "DT", taskId: "T1" });
  });

  test("duplicate-id: first kept, later excluded", async () => {
    const { specs, issues } = validateSpecs(await load("dup-a", "dup-b"));
    expect(specs.map((s) => [s.id, s.title])).toEqual([["D", "Dup A"]]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "duplicate-id", specId: "D" });
  });

  test("unresolved-dependency: spec kept, related names the missing id", async () => {
    const { specs, issues } = validateSpecs(await load("unresolved"));
    expect(specs.map((s) => s.id)).toEqual(["UN"]);
    expect(issues).toEqual([
      {
        kind: "unresolved-dependency",
        specId: "UN",
        message: expect.stringContaining("ZZZ"),
        related: ["ZZZ"],
      },
    ]);
  });

  test("self-dependency: reported once and not as a cycle", async () => {
    const { specs, issues } = validateSpecs(await load("self"));
    expect(specs.map((s) => s.id)).toEqual(["S"]);
    expect(issues.map((i) => i.kind)).toEqual(["self-dependency"]);
    expect(issues[0]!.specId).toBe("S");
  });

  test("dependency-cycle: A->B->C->A reported exactly once, sorted", async () => {
    const { specs, issues } = validateSpecs(await load("cycle-c", "cycle-a", "cycle-b"));
    expect(specs).toHaveLength(3);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "dependency-cycle",
      specId: "CA",
      related: ["CA", "CB", "CC"],
    });
  });
});

describe("validateSpecs: combinations", () => {
  test("a spec with an unresolved dependency and a cycle gets both issues", () => {
    const { issues } = validateSpecs([
      { id: "A", title: "A", status: "drafted", dependsOn: ["B", "GONE"] },
      { id: "B", title: "B", status: "drafted", dependsOn: ["A"] },
    ]);
    expect(issues.map((i) => [i.kind, i.specId])).toEqual([
      ["unresolved-dependency", "A"],
      ["dependency-cycle", "A"],
    ]);
  });

  test("two separate cycles give two issues", () => {
    const cycles = findCycles(
      validateSpecs([
        { id: "A", title: "", status: "drafted", dependsOn: ["B"] },
        { id: "B", title: "", status: "drafted", dependsOn: ["A"] },
        { id: "C", title: "", status: "drafted", dependsOn: ["D"] },
        { id: "D", title: "", status: "drafted", dependsOn: ["C"] },
      ]).specs,
    );
    expect(cycles.sort()).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  test("a long dependency chain does not overflow the stack", () => {
    const raw = Array.from({ length: 20000 }, (_, i) => ({
      id: `S${i}`,
      title: `S${i}`,
      status: "drafted",
      dependsOn: i > 0 ? [`S${i - 1}`] : [],
    }));
    const { specs, issues } = validateSpecs(raw);
    expect(specs).toHaveLength(20000);
    expect(issues).toEqual([]);
  });

  test("all invalid fixtures at once: no throw, every kind reported", async () => {
    const result = await scan(createStubAdapter(), { roots: [invalidRoot] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = new Set<string>(result.snapshot.issues.map((i: Issue) => i.kind));
    expect([...kinds].sort()).toEqual(
      [
        "dependency-cycle",
        "duplicate-id",
        "duplicate-task-id",
        "invalid-shape",
        "invalid-status",
        "invalid-task",
        "missing-title",
        "self-dependency",
        "unresolved-dependency",
      ].sort(),
    );
    // bad-status is the only excluded-by-status spec; the rest stay.
    const ids = result.snapshot.specs.map((s) => s.id);
    expect(ids).not.toContain("BS");
    expect(ids).toEqual(
      expect.arrayContaining(["BT", "CA", "CB", "CC", "D", "DT", "S", "T", "UN"]),
    );
  });

  test("repo-a's valid specs produce zero issues", async () => {
    const result = await scan(createStubAdapter(), {
      roots: [path.join(FIXTURES, "stub", "repo-a")],
    });
    expect(result.ok && result.snapshot.issues).toEqual([]);
  });
});
