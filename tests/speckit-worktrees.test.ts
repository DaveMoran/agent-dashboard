import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { speckitAdapter } from "../src/adapters/speckit";
import type { Snapshot } from "../src/core/model";
import { scan } from "../src/core/scan";
import { resolveRoots } from "../src/git/worktrees";
import { addWorktree, gitState, makeGitRepo, snapshotTree } from "./git-helpers";
import { cleanupFixtures } from "./helpers";

afterEach(cleanupFixtures);

async function scanRoots(roots: string[]): Promise<Snapshot> {
  const result = await scan(speckitAdapter, { roots });
  if (!result.ok) throw new Error(`scan failed: ${result.error.message}`);
  return result.snapshot;
}

async function put(dir: string, rel: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), text);
}

const ALL_TICKED = "- [x] T001 A\n- [x] T002 B\n- [x] T003 C\n- [x] T004 D\n- [x] T005 E\n";

describe("speckit adapter across worktrees", () => {
  test("planner-only spec appears and the checked-out branch's copy wins", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const b = await addWorktree(repo, { newBranch: "004-in-progress" });
    await put(b, "specs/004-in-progress/tasks.md", ALL_TICKED);
    await put(b, "specs/010-planner-only/spec.md", "# Feature Specification: Planner Only\n");

    const snap = await scanRoots(await resolveRoots(repo));
    const matches = snap.specs.filter((s) => s.id === "004");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.status).toBe("review");
    expect(matches[0]!.source).toStrictEqual({ root: b, branch: "004-in-progress" });
    const planner = snap.specs.find((s) => s.id === "010");
    expect(planner?.title).toBe("Planner Only");
    expect(planner?.source?.root).toBe(b);
    expect(snap.issues.some((i) => i.kind === "duplicate-id")).toBe(false);
  });

  test("starting from the other worktree gives the same specs", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const b = await addWorktree(repo, { newBranch: "004-in-progress" });
    await put(b, "specs/004-in-progress/tasks.md", ALL_TICKED);
    await put(b, "specs/010-planner-only/spec.md", "# Feature Specification: Planner Only\n");

    const roots = await resolveRoots(b);
    expect(roots[0]).toBe(b);
    const fromB = await scanRoots(roots);
    const fromRepo = await scanRoots(await resolveRoots(repo));
    // Copies without a matching branch come from the first root, so only `source` may differ.
    const content = (snap: Snapshot) =>
      snap.specs.map(({ id, title, status, tasks }) => ({ id, title, status, tasks }));
    expect(content(fromB)).toStrictEqual(content(fromRepo));
    expect(fromB.specs.find((s) => s.id === "004")?.source?.root).toBe(b);
  });

  test("with no copy on its branch the first root wins", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const c = await addWorktree(repo, { detach: true });
    await put(c, "specs/003-ready/tasks.md", "- [x] T001 One\n- [ ] T002 Two\n- [ ] T003 Three\n");

    const fromRepo = (await scanRoots(await resolveRoots(repo))).specs.find((s) => s.id === "003")!;
    expect(fromRepo.status).toBe("ready");
    expect(fromRepo.source).toStrictEqual({ root: repo, branch: "main" });

    const fromC = (await scanRoots(await resolveRoots(c))).specs.find((s) => s.id === "003")!;
    expect(fromC.status).toBe("in-progress");
    expect(fromC.source).toStrictEqual({ root: c });
  });

  test("a missing worktree is reported and the rest still scans", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const d = await addWorktree(repo, { detach: true });
    await rm(d, { recursive: true });

    const snap = await scanRoots(await resolveRoots(repo));
    const issue = snap.issues.find((i) => i.kind === "unreadable-path");
    expect(issue?.message).toContain(d);
    expect(snap.specs.map((s) => s.id)).toStrictEqual([
      "001",
      "002",
      "003",
      "004",
      "005",
      "006",
      "007",
      "008",
    ]);
  });

  test("a single worktree has itself as the only root", async () => {
    const repo = await makeGitRepo("speckit/repo");
    expect(await resolveRoots(repo)).toStrictEqual([repo]);
    const spec = (await scanRoots([repo])).specs.find((s) => s.id === "003")!;
    expect(spec.source).toStrictEqual({ root: repo, branch: "main" });
  });

  test("scanning never changes files, refs or the worktree list", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const b = await addWorktree(repo, { newBranch: "004-in-progress" });
    const c = await addWorktree(repo, { detach: true });
    const dirs = [repo, b, c];

    const filesBefore = await snapshotTree(dirs);
    const stateBefore = await gitState(repo);
    for (let i = 0; i < 2; i++) await scanRoots(await resolveRoots(repo));
    expect(await snapshotTree(dirs)).toStrictEqual(filesBefore);
    expect(await gitState(repo)).toBe(stateBefore);
  });

  test("20 features across two worktrees scan in under a second (SC-007)", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const b = await addWorktree(repo, { newBranch: "004-in-progress" });
    for (let n = 100; n < 120; n++) {
      const dir = n < 110 ? repo : b;
      const name = `${n}-f`;
      await put(dir, `specs/${name}/spec.md`, `# Feature Specification: F${n}\n`);
      await put(dir, `specs/${name}/plan.md`, "# Implementation Plan\n");
      await put(dir, `specs/${name}/tasks.md`, "- [x] T001 A\n- [ ] T002 B\n- [ ] T003 C\n");
    }
    const roots = await resolveRoots(repo);
    const start = performance.now();
    const snap = await scanRoots(roots);
    const elapsed = performance.now() - start;
    expect(snap.specs.filter((s) => Number(s.id) >= 100)).toHaveLength(20);
    expect(elapsed).toBeLessThan(1000);
  });
});
