import type { AgentSession } from "../agents/source.js";
import type { ProjectView, SessionView, SessionsResponse } from "../contract/sessions.js";

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildSessionsResponse(sessions: AgentSession[]): SessionsResponse {
  const byProject = new Map<string, { name: string; views: SessionView[] }>();
  for (const s of sessions) {
    if (!s.isMain || s.cwd === undefined || s.model === undefined || s.lastActivity === undefined) {
      continue;
    }
    const view: SessionView = {
      sessionId: s.sessionId,
      model: s.model,
      cwd: s.cwd,
      state: s.state,
      runningSubagents: s.runningSubagents,
      stateSince: s.stateSince ?? null,
      lastActivity: s.lastActivity,
    };
    const entry = byProject.get(s.projectId);
    if (entry) entry.views.push(view);
    else byProject.set(s.projectId, { name: s.projectName, views: [view] });
  }

  const projects: ProjectView[] = [];
  for (const [id, { name, views }] of byProject) {
    views.sort((a, b) => cmp(b.lastActivity, a.lastActivity) || cmp(a.sessionId, b.sessionId));
    projects.push({ id, name, lastActivity: views[0]!.lastActivity, sessions: views });
  }
  projects.sort((a, b) => cmp(b.lastActivity, a.lastActivity) || cmp(a.id, b.id));
  return { projects };
}
