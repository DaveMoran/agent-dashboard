import { mkdtemp, readdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyFixture, trackTempDir } from "./helpers";

/** Run git in cwd with a fixed identity and no hooks or signing. Throws on failure. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(
    [
      "git",
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout;
}

export async function commitAll(repo: string, message: string): Promise<void> {
  await git(repo, "add", "-A");
  await git(repo, "commit", "-q", "--allow-empty", "-m", message);
}

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "av-git-")));
  trackTempDir(dir);
  return dir;
}

/** A fresh git repo, optionally filled from a fixture and committed. */
export async function makeGitRepo(
  fixture?: string,
  options: { branch?: string } = {},
): Promise<string> {
  const dir = fixture === undefined ? await tempDir() : await copyFixture(fixture);
  await git(dir, "init", "-q", "-b", options.branch ?? "main");
  if (fixture !== undefined) await commitAll(dir, "fixture");
  return dir;
}

/** Add a worktree of repo in a fresh temp dir; returns the worktree path. */
export async function addWorktree(
  repo: string,
  options: { newBranch?: string; branch?: string; detach?: boolean; from?: string },
): Promise<string> {
  const wt = path.join(await tempDir(), "wt");
  if (options.newBranch !== undefined) {
    await git(repo, "worktree", "add", "-q", "-b", options.newBranch, wt, options.from ?? "main");
  } else if (options.branch !== undefined) {
    await git(repo, "worktree", "add", "-q", wt, options.branch);
  } else if (options.detach) {
    await git(repo, "worktree", "add", "-q", "--detach", wt, options.from ?? "main");
  } else {
    throw new Error("addWorktree needs newBranch, branch or detach");
  }
  return wt;
}

/** `<dir>|<relative path>|<sha1>` for every file below each dir (skipping .git), sorted. */
export async function snapshotTree(dirs: string[]): Promise<string[]> {
  const out: string[] = [];
  async function visit(base: string, dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(base, full);
      else if (entry.isFile()) {
        const hash = new Bun.CryptoHasher("sha1").update(await readFile(full)).digest("hex");
        out.push(`${base}|${path.relative(base, full)}|${hash}`);
      }
    }
  }
  for (const dir of dirs) await visit(dir, dir);
  return out.sort();
}

/** Refs plus worktree list: everything a scan must leave untouched in .git. */
export async function gitState(repo: string): Promise<string> {
  return (await git(repo, "for-each-ref")) + (await git(repo, "worktree", "list", "--porcelain"));
}
