import { runGit } from "./run";

export interface Worktree {
  path: string;
  branch: string | null;
  bare: boolean;
  prunable: boolean;
}

export function parseWorktreePorcelain(text: string): Worktree[] {
  const result: Worktree[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let wt: Worktree | null = null;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) {
        wt = { path: line.slice("worktree ".length), branch: null, bare: false, prunable: false };
      } else if (wt === null) {
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        wt.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
      } else if (line === "bare") {
        wt.bare = true;
      } else if (line === "prunable" || line.startsWith("prunable ")) {
        wt.prunable = true;
      }
    }
    if (wt !== null) result.push(wt);
  }
  return result;
}

export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const r = await runGit(cwd, ["worktree", "list", "--porcelain"]);
  return r.code === 0 ? parseWorktreePorcelain(r.stdout) : [];
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const r = await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** The repo's top-level checkout first, then every other non-bare worktree. */
export async function resolveRoots(repoPath: string): Promise<string[]> {
  const top = await runGit(repoPath, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return [repoPath];
  const topPath = top.stdout.trim();
  const others = (await listWorktrees(repoPath))
    .filter((w) => !w.bare && w.path !== topPath)
    .map((w) => w.path);
  return [...new Set([topPath, ...others])];
}
