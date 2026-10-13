import type { Event, Issue, Role, Spec, SpecSource, SpecStatus, Task } from "./model";
import { ROLES, STATUSES } from "./model";

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function stringList(
  value: unknown,
  field: string,
  specId: string,
  issues: Issue[],
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push({
      kind: "invalid-shape",
      specId,
      message: `Spec "${specId}": "${field}" must be a list, got ${describe(value)}`,
    });
    return [];
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      out.push(entry);
    } else {
      issues.push({
        kind: "invalid-shape",
        specId,
        message: `Spec "${specId}": "${field}" entry ${describe(entry)} is not a string and was dropped`,
      });
    }
  }
  return out;
}

function normalizeTasks(value: unknown, specId: string, issues: Issue[]): Task[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push({
      kind: "invalid-shape",
      specId,
      message: `Spec "${specId}": "tasks" must be a list, got ${describe(value)}`,
    });
    return [];
  }
  const tasks: Task[] = [];
  const seen = new Set<string>();
  const reportedDup = new Set<string>();
  for (const raw of value) {
    const valid =
      isRecord(raw) &&
      isNonEmptyString(raw.id) &&
      typeof raw.text === "string" &&
      typeof raw.done === "boolean" &&
      (raw.phase === undefined || typeof raw.phase === "string") &&
      (raw.parallel === undefined || typeof raw.parallel === "boolean");
    if (!valid) {
      const taskId = isRecord(raw) && isNonEmptyString(raw.id) ? raw.id : undefined;
      const issue: Issue = {
        kind: "invalid-task",
        specId,
        message: `Spec "${specId}": task ${describe(raw)} needs a string id, string text and boolean done; dropped`,
      };
      if (taskId !== undefined) issue.taskId = taskId;
      issues.push(issue);
      continue;
    }
    const r = raw as Raw;
    const task: Task = { id: r.id as string, text: r.text as string, done: r.done as boolean };
    if (r.phase !== undefined) task.phase = r.phase as string;
    if (r.parallel !== undefined) task.parallel = r.parallel as boolean;
    if (seen.has(task.id) && !reportedDup.has(task.id)) {
      reportedDup.add(task.id);
      issues.push({
        kind: "duplicate-task-id",
        specId,
        taskId: task.id,
        message: `Spec "${specId}": task id "${task.id}" is used more than once`,
      });
    }
    seen.add(task.id);
    tasks.push(task);
  }
  return tasks;
}

function normalizeSource(
  value: unknown,
  specId: string,
  issues: Issue[],
): SpecSource | undefined {
  if (value === undefined) return undefined;
  if (isRecord(value) && typeof value.root === "string") {
    const source: SpecSource = { root: value.root };
    if (typeof value.branch === "string") source.branch = value.branch;
    return source;
  }
  issues.push({
    kind: "invalid-shape",
    specId,
    message: `Spec "${specId}": "source" must be { root: string }, got ${describe(value)}`,
  });
  return undefined;
}

/** Returns the spec, or null when it must be excluded (issues already pushed). */
function normalizeSpec(raw: Raw, id: string, issues: Issue[]): Spec | null {
  let title: string;
  if (isNonEmptyString(raw.title)) {
    title = raw.title;
  } else {
    title = id;
    issues.push({
      kind: "missing-title",
      specId: id,
      message: `Spec "${id}" has no usable title (got ${describe(raw.title)}); using the id`,
    });
  }

  if (typeof raw.status !== "string" || !(STATUSES as readonly string[]).includes(raw.status)) {
    issues.push({
      kind: "invalid-status",
      specId: id,
      message: `Spec "${id}" has invalid status ${describe(raw.status)}; expected one of ${STATUSES.join(", ")}`,
    });
    return null;
  }

  const tasks = normalizeTasks(raw.tasks, id, issues);
  const dependsOn = stringList(raw.dependsOn, "dependsOn", id, issues);
  const artifacts = stringList(raw.artifacts, "artifacts", id, issues);
  const spec: Spec = {
    id,
    title,
    status: raw.status as SpecStatus,
    dependsOn,
    tasks,
    artifacts,
  };
  if (typeof raw.branch === "string") spec.branch = raw.branch;
  else if (raw.branch !== undefined) {
    issues.push({
      kind: "invalid-shape",
      specId: id,
      message: `Spec "${id}": "branch" must be a string, got ${describe(raw.branch)}`,
    });
  }
  const source = normalizeSource(raw.source, id, issues);
  if (source) spec.source = source;
  return spec;
}

/** Strongly connected components of 2+ specs (iterative Tarjan). Self-edges are ignored. */
export function findCycles(specs: Spec[]): string[][] {
  const ids = new Set(specs.map((s) => s.id));
  const edges = new Map<string, string[]>();
  for (const s of specs) {
    edges.set(
      s.id,
      s.dependsOn.filter((d) => d !== s.id && ids.has(d)),
    );
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  for (const start of ids) {
    if (index.has(start)) continue;
    const work: { id: string; next: number }[] = [{ id: start, next: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const out = edges.get(frame.id)!;
      if (frame.next < out.length) {
        const to = out[frame.next++]!;
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter);
          counter++;
          stack.push(to);
          onStack.add(to);
          work.push({ id: to, next: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(to)!));
        }
      } else {
        work.pop();
        const parent = work[work.length - 1];
        if (parent) {
          low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
        }
        if (low.get(frame.id) === index.get(frame.id)) {
          const component: string[] = [];
          let member: string;
          do {
            member = stack.pop()!;
            onStack.delete(member);
            component.push(member);
          } while (member !== frame.id);
          if (component.length >= 2) cycles.push(component.sort());
        }
      }
    }
  }
  return cycles;
}

const DEPENDENCY_ORDER = ["unresolved-dependency", "self-dependency", "dependency-cycle"];

function dependencyIssues(specs: Spec[]): Issue[] {
  const ids = new Set(specs.map((s) => s.id));
  const issues: Issue[] = [];
  for (const spec of specs) {
    for (const dep of spec.dependsOn) {
      if (dep === spec.id) {
        issues.push({
          kind: "self-dependency",
          specId: spec.id,
          message: `Spec "${spec.id}" depends on itself`,
          related: [spec.id],
        });
      } else if (!ids.has(dep)) {
        issues.push({
          kind: "unresolved-dependency",
          specId: spec.id,
          message: `Spec "${spec.id}" depends on unknown spec "${dep}"`,
          related: [dep],
        });
      }
    }
  }
  for (const members of findCycles(specs)) {
    issues.push({
      kind: "dependency-cycle",
      specId: members[0]!,
      message: `Dependency cycle between specs: ${members.join(", ")}`,
      related: members,
    });
  }
  return issues.sort(
    (a, b) =>
      (a.specId! < b.specId! ? -1 : a.specId! > b.specId! ? 1 : 0) ||
      DEPENDENCY_ORDER.indexOf(a.kind) - DEPENDENCY_ORDER.indexOf(b.kind),
  );
}

export function validateSpecs(raw: unknown[]): { specs: Spec[]; issues: Issue[] } {
  const specs: Spec[] = [];
  const issues: Issue[] = [];
  const duplicateIssues: Issue[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!isRecord(item)) {
      issues.push({
        kind: "invalid-shape",
        message: `Spec entry is not an object: ${describe(item)}`,
      });
      continue;
    }
    if (!isNonEmptyString(item.id)) {
      issues.push({
        kind: "invalid-shape",
        message: `Spec entry has no usable id: ${describe(item.id)}`,
      });
      continue;
    }
    if (seen.has(item.id)) {
      duplicateIssues.push({
        kind: "duplicate-id",
        specId: item.id,
        message: `Spec id "${item.id}" appears more than once; keeping the first`,
      });
      continue;
    }
    const spec = normalizeSpec(item, item.id, issues);
    if (spec) {
      seen.add(spec.id);
      specs.push(spec);
    }
  }

  return {
    specs,
    issues: [...issues, ...duplicateIssues, ...dependencyIssues(specs)],
  };
}

export type EventResult = { ok: true; event: Event } | { ok: false; reason: string };

export function validateEvent(raw: unknown): EventResult {
  if (!isRecord(raw)) {
    return { ok: false, reason: `event must be an object, got ${describe(raw)}` };
  }
  if (typeof raw.ts !== "string" || Number.isNaN(Date.parse(raw.ts))) {
    return { ok: false, reason: `"ts" must be a date string, got ${describe(raw.ts)}` };
  }
  if (typeof raw.role !== "string" || !(ROLES as readonly string[]).includes(raw.role)) {
    return {
      ok: false,
      reason: `"role" must be one of ${ROLES.join(", ")}, got ${describe(raw.role)}`,
    };
  }
  if (!isNonEmptyString(raw.kind)) {
    return { ok: false, reason: `"kind" must be a non-empty string, got ${describe(raw.kind)}` };
  }
  if (raw.specId !== undefined && typeof raw.specId !== "string") {
    return { ok: false, reason: `"specId" must be a string, got ${describe(raw.specId)}` };
  }
  const event: Event = {
    ts: raw.ts,
    role: raw.role as Role,
    kind: raw.kind,
    detail: raw.detail,
  };
  if (raw.specId !== undefined) event.specId = raw.specId;
  return { ok: true, event };
}
