export const STATUSES = [
  "drafted",
  "planned",
  "ready",
  "in-progress",
  "review",
  "done",
  "blocked",
] as const;
export type SpecStatus = (typeof STATUSES)[number];

export const ROLES = ["planner", "coder", "human", "git"] as const;
export type Role = (typeof ROLES)[number];

export interface Task {
  id: string;
  text: string;
  done: boolean;
  phase?: string;
  parallel?: boolean;
}

export interface SpecSource {
  root: string;
  branch?: string;
}

export interface Spec {
  id: string;
  title: string;
  status: SpecStatus;
  dependsOn: string[];
  tasks: Task[];
  artifacts: string[];
  branch?: string;
  source?: SpecSource;
}

export interface Event {
  ts: string;
  role: Role;
  specId?: string;
  kind: string;
  detail: unknown;
}

export type IssueKind =
  | "invalid-shape"
  | "missing-title"
  | "invalid-status"
  | "invalid-task"
  | "duplicate-task-id"
  | "duplicate-id"
  | "unresolved-dependency"
  | "self-dependency"
  | "dependency-cycle"
  | "unreadable-path"
  | "detect-failed";

export interface Issue {
  kind: IssueKind;
  specId?: string;
  taskId?: string;
  message: string;
  related?: string[];
}

export interface Snapshot {
  specs: Spec[];
  issues: Issue[];
  adapter: string | null;
  scannedAt: string;
}
