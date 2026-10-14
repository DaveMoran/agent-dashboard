import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { speckitAdapter } from "../src/adapters/speckit";
import type { Snapshot } from "../src/core/model";
import { scan } from "../src/core/scan";
import { runGit } from "../src/git/run";
import { resolveRoots } from "../src/git/worktrees";
import { commitAll, git, makeGitRepo } from "./git-helpers";
import { cleanupFixtures, copyFixture } from "./helpers";

afterEach(cleanupFixtures);

async function scanRepo(repo: string): Promise<Snapshot> {
  const result = await scan(speckitAdapter, { roots: await resolveRoots(repo) });
  if (!result.ok) throw new Error(`scan failed: ${result.error.message}`);
  return result.snapshot;
}

function statusOf(snap: Snapshot, id: string): string | undefined {
  return snap.specs.find((s) => s.id === id)?.status;
}

async function addFeature(dir: string, name: string, ticked: boolean): Promise<void> {
  const base = path.join(dir, "specs", name);
  await mkdir(base, { recursive: true });
  await writeFile(path.join(base, "spec.md"), `# Feature Specification: ${name}\n`);
  await writeFile(path.join(base, "plan.md"), "# Implementation Plan\n");
  const box = ticked ? "x" : " ";
  await writeFile(path.join(base, "tasks.md"), `- [${box}] T001 One\n- [${box}] T002 Two\n`);
}

describe("speckit merged rule", () => {
  test("fixture on main: only the fully ticked feature is done", async () => {
    const snap = await scanRepo(await makeGitRepo("speckit/repo"));
    expect(statusOf(snap, "005")).toBe("done");
    expect(statusOf(snap, "004")).toBe("in-progress");
    expect(statusOf(snap, "003")).toBe("ready");
    expect(statusOf(snap, "001")).toBe("drafted");
  });

  test("merge commit is done, and stays done after the branch is deleted", async () => {
    const repo = await makeGitRepo("speckit/repo");
    await git(repo, "switch", "-q", "-c", "011-merged");
    await addFeature(repo, "011-merged", true);
    await commitAll(repo, "feature");
    await git(repo, "switch", "-q", "main");
    await git(repo, "merge", "--no-ff", "-q", "-m", "merge", "011-merged");
    expect(statusOf(await scanRepo(repo), "011")).toBe("done");

    await git(repo, "branch", "-D", "011-merged");
    expect(statusOf(await scanRepo(repo), "011")).toBe("done");
  });

  test("squash merge is done even though the branch is not an ancestor", async () => {
    const repo = await makeGitRepo("speckit/repo");
    await git(repo, "switch", "-q", "-c", "012-squashed");
    await addFeature(repo, "012-squashed", true);
    await commitAll(repo, "feature");
    await git(repo, "switch", "-q", "main");
    await git(repo, "merge", "--squash", "012-squashed");
    await commitAll(repo, "squash");
    const ancestor = await runGit(repo, ["merge-base", "--is-ancestor", "012-squashed", "main"]);
    expect(ancestor.code).toBe(1);
    expect(statusOf(await scanRepo(repo), "012")).toBe("done");
  });

  test("fully ticked but unmerged is review", async () => {
    const repo = await makeGitRepo("speckit/repo");
    await git(repo, "switch", "-q", "-c", "013-review");
    await addFeature(repo, "013-review", true);
    await commitAll(repo, "feature");
    expect(statusOf(await scanRepo(repo), "013")).toBe("review");
  });

  test("a fresh uncommitted branch is drafted", async () => {
    const repo = await makeGitRepo("speckit/repo");
    await git(repo, "switch", "-q", "-c", "014-fresh");
    await mkdir(path.join(repo, "specs/014-fresh"), { recursive: true });
    await writeFile(path.join(repo, "specs/014-fresh/spec.md"), "# Feature Specification: Fresh\n");
    expect(statusOf(await scanRepo(repo), "014")).toBe("drafted");
  });

  test("a spec merged early with unticked tasks is ready, not done", async () => {
    const repo = await makeGitRepo("speckit/repo");
    await git(repo, "switch", "-q", "-c", "015-early");
    await addFeature(repo, "015-early", false);
    await commitAll(repo, "feature");
    await git(repo, "switch", "-q", "main");
    await git(repo, "merge", "--no-ff", "-q", "-m", "merge", "015-early");
    expect(statusOf(await scanRepo(repo), "015")).toBe("ready");
  });

  test("without a main branch nothing is done", async () => {
    const snap = await scanRepo(await makeGitRepo("speckit/repo", { branch: "trunk" }));
    expect(statusOf(snap, "005")).toBe("review");
    expect(snap.specs.some((s) => s.status === "done")).toBe(false);
  });

  test("outside git nothing is done", async () => {
    const snap = await scanRepo(await copyFixture("speckit/repo"));
    expect(statusOf(snap, "005")).toBe("review");
    expect(snap.specs.some((s) => s.status === "done")).toBe(false);
  });
});
