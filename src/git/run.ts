export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a read-only git command in cwd. Never rejects. */
export async function runGit(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const proc = Bun.spawn(["git", "-C", cwd, ...args], {
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { code, stdout, stderr };
  } catch (err) {
    return { code: -1, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}
