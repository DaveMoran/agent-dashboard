import { runGit } from "../../git/run";
import { parseTasks } from "./tasks";

/** True when local `main` holds a fully ticked tasks.md for the feature. Never throws. */
export async function isMergedIntoMain(root: string, dirName: string): Promise<boolean> {
  const main = await runGit(root, ["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"]);
  if (main.code !== 0) return false;
  const shown = await runGit(root, ["show", `refs/heads/main:specs/${dirName}/tasks.md`]);
  if (shown.code !== 0) return false;
  const tasks = parseTasks(shown.stdout);
  return tasks.length > 0 && tasks.every((t) => t.done);
}
