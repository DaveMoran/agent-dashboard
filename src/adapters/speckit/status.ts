import type { SpecStatus, Task } from "../../core/model";

export interface StatusInput {
  hasPlan: boolean;
  hasTasks: boolean;
  tasks: Task[];
  merged: boolean;
}

export function deriveStatus(input: StatusInput): SpecStatus {
  const { hasPlan, hasTasks, tasks, merged } = input;
  if (merged) return "done";
  if (hasTasks && tasks.length > 0 && tasks.every((t) => t.done)) return "review";
  if (hasTasks && tasks.some((t) => t.done)) return "in-progress";
  if (hasTasks) return "ready";
  if (hasPlan) return "planned";
  return "drafted";
}
