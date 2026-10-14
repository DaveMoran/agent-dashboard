import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGit } from "../src/git/run";
import { makeGitRepo } from "./git-helpers";
import { cleanupFixtures, trackTempDir } from "./helpers";

afterEach(cleanupFixtures);

describe("runGit", () => {
  test("returns code and stdout inside a repo", async () => {
    const repo = await makeGitRepo();
    const result = await runGit(repo, ["rev-parse", "--is-inside-work-tree"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("true\n");
  });

  test("reports a non-zero code and stderr outside a repo", async () => {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "av-plain-")));
    trackTempDir(dir);
    const result = await runGit(dir, ["rev-parse", "--is-inside-work-tree"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).not.toBe("");
  });

  test("resolves, never rejects, when cwd does not exist", async () => {
    const result = await runGit("/nonexistent/av-missing-dir", ["rev-parse", "HEAD"]);
    expect(result.code).not.toBe(0);
  });
});
