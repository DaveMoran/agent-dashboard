import type { Issue, Spec, SpecStatus, Task } from "./model";

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function normalizeTask(raw: Raw): Task {
  const task: Task = {
    id: raw.id as string,
    text: raw.text as string,
    done: raw.done as boolean,
  };
  if (raw.phase !== undefined) task.phase = raw.phase as string;
  if (raw.parallel !== undefined) task.parallel = raw.parallel as boolean;
  return task;
}

function normalizeSpec(raw: Raw, id: string): Spec {
  const spec: Spec = {
    id,
    title: raw.title as string,
    status: raw.status as SpecStatus,
    dependsOn: Array.isArray(raw.dependsOn) ? (raw.dependsOn as string[]) : [],
    tasks: Array.isArray(raw.tasks)
      ? (raw.tasks as unknown[]).filter(isRecord).map(normalizeTask)
      : [],
    artifacts: Array.isArray(raw.artifacts) ? (raw.artifacts as string[]) : [],
  };
  if (raw.branch !== undefined) spec.branch = raw.branch as string;
  if (raw.source !== undefined) spec.source = raw.source as Spec["source"];
  return spec;
}

export function validateSpecs(raw: unknown[]): { specs: Spec[]; issues: Issue[] } {
  const specs: Spec[] = [];
  const issues: Issue[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      issues.push({
        kind: "invalid-shape",
        message: `Spec entry is not an object: ${describe(item)}`,
      });
      continue;
    }
    if (typeof item.id !== "string" || item.id === "") {
      issues.push({
        kind: "invalid-shape",
        message: `Spec entry has no usable id: ${describe(item.id)}`,
      });
      continue;
    }
    specs.push(normalizeSpec(item, item.id));
  }
  return { specs, issues };
}
