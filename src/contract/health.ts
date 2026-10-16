// Types for GET /api/health. This file must import nothing.
export interface HealthResponse {
  status: "ok";
  repoPath: string;
  repoName: string;
  version: string;
  attentionHook: {
    seen: boolean;
    lastEventAt: string | null;
  };
}
