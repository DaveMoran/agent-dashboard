import path from "node:path";
import { runGit } from "../../git/run";

export interface ProjectRef {
  id: string;
  name: string;
  inGit: boolean;
}

/** Project name from an absolute git common dir. */
export function projectNameFromCommonDir(commonDir: string): string {
  const trimmed = commonDir.replace(/\/+$/, "");
  if (path.basename(trimmed) === ".git") return path.basename(path.dirname(trimmed));
  return path.basename(trimmed).replace(/\.git$/, "");
}

/** Resolve a cwd to its project (shared by all worktrees); one git call per distinct cwd. */
export function createProjectResolver(run: typeof runGit = runGit): (cwd: string) => Promise<ProjectRef> {
  const cache = new Map<string, Promise<ProjectRef>>();
  async function resolve(cwd: string): Promise<ProjectRef> {
    const result = await run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const id = result.stdout.trim();
    if (result.code === 0 && id !== "") {
      return { id, name: projectNameFromCommonDir(id), inGit: true };
    }
    return { id: cwd, name: path.basename(cwd), inGit: false };
  }
  return (cwd) => {
    let hit = cache.get(cwd);
    if (hit === undefined) {
      hit = resolve(cwd);
      cache.set(cwd, hit);
    }
    return hit;
  };
}
