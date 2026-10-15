import type { Task } from "../../core/model";
import { runGit } from "../../git/run";
import { parseTasks } from "./tasks";

/** The fully ticked tasks from local `main`'s tasks.md, or null when the feature is not merged. Never throws. */
export async function mergedMainTasks(root: string, dirName: string): Promise<Task[] | null> {
  const main = await runGit(root, ["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"]);
  if (main.code !== 0) return null;
  const shown = await runGit(root, ["show", `refs/heads/main:specs/${dirName}/tasks.md`]);
  if (shown.code !== 0) return null;
  const tasks = parseTasks(shown.stdout);
  return tasks.length > 0 && tasks.every((t) => t.done) ? tasks : null;
}

/** True when local `main` holds a fully ticked tasks.md for the feature. Never throws. */
export async function isMergedIntoMain(root: string, dirName: string): Promise<boolean> {
  return (await mergedMainTasks(root, dirName)) !== null;
}
