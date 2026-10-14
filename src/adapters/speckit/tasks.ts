import type { Task } from "../../core/model";

const PHASE_RE = /^## +(Phase\b.*?)\s*$/;
const TASK_RE = /^\s*[-*] \[([ xX])\] +(T\d+)\b(.*)$/;
const TOKEN_RE = /^\[[^\]]*\]/;

/** True for a line that opens or closes a fenced code block. */
export function isFenceLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("```") || t.startsWith("~~~");
}

export function parseTasks(tasksMd: string): Task[] {
  const tasks: Task[] = [];
  let inFence = false;
  let phase: string | undefined;

  for (const raw of tasksMd.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const phaseMatch = PHASE_RE.exec(line);
    if (phaseMatch) {
      phase = phaseMatch[1];
      continue;
    }

    const m = TASK_RE.exec(line);
    if (!m) continue;

    let rest = m[3]!.trimStart();
    let parallel = false;
    const kept: string[] = [];
    for (;;) {
      const token = TOKEN_RE.exec(rest);
      if (!token) break;
      if (token[0] === "[P]") parallel = true;
      else kept.push(token[0]);
      rest = rest.slice(token[0].length).trimStart();
    }
    const text = [...kept, rest].filter((s) => s !== "").join(" ").trim();

    const task: Task = { id: m[2]!, text, done: m[1] !== " " };
    if (phase !== undefined) task.phase = phase;
    if (parallel) task.parallel = true;
    tasks.push(task);
  }
  return tasks;
}
