import path from "node:path";
import type { AgentSession } from "../agents/source";
import type { BrainName, BrainProject, BrainState, BrainView } from "../contract/magi";

export interface SlotOptions {
  idleMs: number;
  waitingMs: number;
}

export interface SlotState {
  brains: BrainView[];
  prevLive: Map<string, string>;
  started: boolean;
}

export const BRAIN_NAMES = ["MELCHIOR", "BALTHASAR", "CASPER"] as const;

interface ActiveProject {
  project: BrainProject;
  activity: number;
  state: Exclude<BrainState, "not-active">;
}

function freeBrain(index: number): BrainView {
  return {
    number: (index + 1) as BrainView["number"],
    name: BRAIN_NAMES[index] as BrainName,
    state: "not-active",
    stateSince: null,
    project: null,
  };
}

export function emptySlotState(): SlotState {
  return { brains: BRAIN_NAMES.map((_, i) => freeBrain(i)), prevLive: new Map(), started: false };
}

export function projectPath(id: string): string {
  return path.basename(id) === ".git" ? path.dirname(id) : id;
}

export function isLive(session: AgentSession, nowMs: number, options: SlotOptions): boolean {
  if (!session.isMain || session.lastActivity === undefined) return false;
  const last = Date.parse(session.lastActivity);
  if (!Number.isFinite(last)) return false;
  return nowMs - last <= (session.state === "waiting" ? options.waitingMs : options.idleMs);
}

function projectState(sessions: AgentSession[]): ActiveProject["state"] {
  if (sessions.some((s) => s.state === "waiting")) return "waiting";
  if (sessions.some((s) => s.state === "working")) return "working";
  return "standby";
}

function activeProjects(live: AgentSession[]): Map<string, ActiveProject> {
  const groups = new Map<string, AgentSession[]>();
  for (const s of live) groups.set(s.projectId, [...(groups.get(s.projectId) ?? []), s]);
  const projects = new Map<string, ActiveProject>();
  for (const [id, sessions] of groups) {
    const activity = (s: AgentSession) => Date.parse(s.lastActivity as string);
    const latest = sessions.reduce((a, b) => (activity(b) > activity(a) ? b : a));
    projects.set(id, {
      project: { id, name: latest.projectName, path: projectPath(id) },
      activity: activity(latest),
      state: projectState(sessions),
    });
  }
  return projects;
}

function keepOrFree(brain: BrainView, active: Map<string, ActiveProject>): BrainView {
  const found = brain.project ? active.get(brain.project.id) : undefined;
  if (!found) return freeBrain(brain.number - 1);
  return { ...brain, state: found.state, project: found.project };
}

function unassigned(brains: BrainView[], active: Map<string, ActiveProject>): ActiveProject[] {
  const held = new Set(brains.map((b) => b.project?.id));
  return [...active.values()]
    .filter((p) => !held.has(p.project.id))
    .sort((a, b) => b.activity - a.activity || (a.project.id < b.project.id ? -1 : 1));
}

function assign(brains: BrainView[], queue: ActiveProject[]): BrainView[] {
  const waiting = [...queue];
  return brains.map((brain) => {
    if (brain.project) return brain;
    const next = waiting.shift();
    return next ? { ...brain, state: next.state, project: next.project } : brain;
  });
}

export function stepSlots(
  prev: SlotState,
  sessions: AgentSession[],
  nowMs: number,
  options: SlotOptions,
): SlotState {
  const live = sessions.filter((s) => isLive(s, nowMs, options));
  const active = activeProjects(live);
  const kept = prev.brains.map((b) => keepOrFree(b, active));
  const brains = assign(kept, unassigned(kept, active));
  return {
    brains,
    prevLive: new Map(live.map((s) => [s.sessionId, s.projectId])),
    started: true,
  };
}
