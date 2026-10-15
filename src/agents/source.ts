import type { SessionState } from "../contract/sessions";

export interface AgentSession {
  sessionId: string;
  source: string;
  projectId: string;
  projectName: string;
  cwd: string | undefined;
  model: string | undefined;
  isMain: boolean;
  state: SessionState;
  runningSubagents: number;
  stateSince: string | undefined;
  lastActivity: string | undefined;
}

export type AgentSourceEvent =
  | { type: "session-added"; session: AgentSession }
  | { type: "session-updated"; session: AgentSession }
  | {
      type: "state-changed";
      sessionId: string;
      projectId: string;
      from: SessionState;
      to: SessionState;
      at: string;
      session: AgentSession;
    };

export interface IngestIssue {
  file: string;
  offset: number;
  reason: "invalid-json" | "not-an-object" | "missing-field" | "unreadable";
  detail: string | undefined;
}

export interface AgentSource {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sessions(): AgentSession[];
  subscribe(listener: (event: AgentSourceEvent) => void): () => void;
  issues(): IngestIssue[];
}
