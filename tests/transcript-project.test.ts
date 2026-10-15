import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProjectResolver, projectNameFromCommonDir } from "../src/agents/transcripts/project";
import type { GitResult } from "../src/git/run";
import { addWorktree, commitAll, makeGitRepo } from "./git-helpers";
import { cleanupFixtures, trackTempDir } from "./helpers";

afterEach(cleanupFixtures);

describe("projectNameFromCommonDir", () => {
  test("names", () => {
    expect(projectNameFromCommonDir("/a/b/repo/.git")).toBe("repo");
    expect(projectNameFromCommonDir("/a/srv/repo.git")).toBe("repo");
  });
});

describe("createProjectResolver", () => {
  test("main checkout, worktree and subfolder share one project", async () => {
    const repo = await makeGitRepo();
    await commitAll(repo, "init");
    const wt = await addWorktree(repo, { newBranch: "wt" });
    const sub = path.join(repo, "sub");
    await mkdir(sub);
    const resolve = createProjectResolver();
    const [a, b, c] = await Promise.all([resolve(repo), resolve(wt), resolve(sub)]);
    expect(a.id.endsWith("/.git")).toBe(true);
    expect(a.inGit).toBe(true);
    expect(a.name).toBe(path.basename(repo));
    expect(b).toStrictEqual(a);
    expect(c).toStrictEqual(a);
  });

  test("different repos differ", async () => {
    const resolve = createProjectResolver();
    const a = await resolve(await makeGitRepo());
    const b = await resolve(await makeGitRepo());
    expect(a.id).not.toBe(b.id);
  });

  test("outside git falls back to the cwd", async () => {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "av-nogit-")));
    trackTempDir(dir);
    expect(await createProjectResolver()(dir)).toStrictEqual({
      id: dir,
      name: path.basename(dir),
      inGit: false,
    });
  });

  test("missing path falls back to the cwd", async () => {
    const missing = path.join(os.tmpdir(), "av-does-not-exist-xyz", "gone");
    const ref = await createProjectResolver()(missing);
    expect(ref.id).toBe(missing);
    expect(ref.inGit).toBe(false);
  });

  test("caches per cwd", async () => {
    let calls = 0;
    const run = async (): Promise<GitResult> => {
      calls++;
      return { code: 0, stdout: "/x/repo/.git\n", stderr: "" };
    };
    const resolve = createProjectResolver(run);
    const refs = await Promise.all([resolve("/c"), resolve("/c")]);
    await resolve("/c");
    expect(calls).toBe(1);
    expect(refs[0]).toStrictEqual({ id: "/x/repo/.git", name: "repo", inGit: true });
  });
});
