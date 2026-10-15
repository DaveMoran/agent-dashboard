// Types for GET /api/sessions. This file must import nothing.
export type SessionState = "working" | "standby"; // 005 adds "waiting"

export interface SessionView {
  sessionId: string;
  model: string;
  cwd: string;
  state: SessionState;
  runningSubagents: number;
  stateSince: string | null;
  lastActivity: string;
}

export interface ProjectView {
  id: string;
  name: string;
  lastActivity: string;
  sessions: SessionView[];
}

export interface SessionsResponse {
  projects: ProjectView[];
}
