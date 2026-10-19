// Types for GET /api/magi. This file must import nothing.
export type BrainState = "not-active" | "standby" | "working" | "waiting";
export type BrainName = "MELCHIOR" | "BALTHASAR" | "CASPER";

export interface BrainProject {
  id: string; // 004 project identity (git common dir, or cwd outside git)
  name: string; // 004 project name
  path: string; // repo's main working directory (dirname of id when id ends in /.git), else id
}

export interface BrainView {
  number: 1 | 2 | 3;
  name: BrainName;
  state: BrainState;
  stateSince: string | null; // ISO 8601; null only for a brain free since start
  project: BrainProject | null; // null iff state === "not-active"
}

export interface MagiResponse {
  brains: BrainView[]; // always exactly 3, ordered by number: MELCHIOR, BALTHASAR, CASPER
}
