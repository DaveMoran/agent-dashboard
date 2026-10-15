import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { currentBranch, parseWorktreePorcelain, resolveRoots } from "../src/git/worktrees";
import { addWorktree, makeGitRepo } from "./git-helpers";
import { cleanupFixtures, trackTempDir } from "./helpers";

afterEach(cleanupFixtures);

describe("parseWorktreePorcelain", () => {
  test("parses the contract example", () => {
    const text = [
      "worktree /r",
      "HEAD 447d36d",
      "branch refs/heads/main",
      "",
      "worktree /w1",
      "HEAD 447d36d",
      "branch refs/heads/003-x",
      "",
      "worktree /w2",
      "HEAD 447d36d",
      "detached",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    expect(parseWorktreePorcelain(text)).toStrictEqual([
      { path: "/r", branch: "main", bare: false, prunable: false },
      { path: "/w1", branch: "003-x", bare: false, prunable: false },
      { path: "/w2", branch: null, bare: false, prunable: true },
    ]);
  });

  test("bare block", () => {
    expect(parseWorktreePorcelain("worktree /bare\nbare\n")).toStrictEqual([
      { path: "/bare", branch: null, bare: true, prunable: false },
    ]);
  });

  test("block without a worktree line is skipped", () => {
    expect(parseWorktreePorcelain("HEAD abc\nbranch refs/heads/x\n")).toStrictEqual([]);
  });
});

describe("resolveRoots", () => {
  test("plain folder, not git", async () => {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "av-plain-")));
    trackTempDir(dir);
    expect(await resolveRoots(dir)).toStrictEqual([dir]);
  });

  test("main checkout lists its worktrees after itself", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const wt = await addWorktree(repo, { newBranch: "003-x" });
    expect(await resolveRoots(repo)).toStrictEqual([repo, wt]);
  });

  test("starting from a worktree puts it first", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const wt = await addWorktree(repo, { newBranch: "003-x" });
    expect(await resolveRoots(wt)).toStrictEqual([wt, repo]);
  });

  test("a subfolder resolves to the top-level checkout", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const wt = await addWorktree(repo, { newBranch: "003-x" });
    await mkdir(path.join(repo, "sub"));
    expect(await resolveRoots(path.join(repo, "sub"))).toStrictEqual([repo, wt]);
  });

  test("a removed worktree folder stays in the list", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const gone = await addWorktree(repo, { detach: true });
    await rm(gone, { recursive: true });
    expect(await resolveRoots(repo)).toStrictEqual([repo, gone]);
  });
});

describe("currentBranch", () => {
  test("branch name, null when detached, null outside git", async () => {
    const repo = await makeGitRepo("speckit/repo");
    const wt = await addWorktree(repo, { newBranch: "003-x" });
    const detached = await addWorktree(repo, { detach: true });
    const plain = await realpath(await mkdtemp(path.join(os.tmpdir(), "av-plain-")));
    trackTempDir(plain);
    expect(await currentBranch(wt)).toBe("003-x");
    expect(await currentBranch(detached)).toBeNull();
    expect(await currentBranch(plain)).toBeNull();
  });
});
