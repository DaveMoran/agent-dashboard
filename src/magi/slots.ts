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

interface Since {
  live: AgentSession[];
  drops: Map<string, number>;
  nowMs: number;
  started: boolean;
}

const iso = (ms: number): string => new Date(ms).toISOString();

function sessionSince(s: AgentSession): number {
  return s.stateSince === undefined ? Number.NaN : Date.parse(s.stateSince);
}

function latestSince(since: Since, projectId: string, state: BrainState): number | undefined {
  const times = since.live
    .filter((s) => s.projectId === projectId && s.state === state)
    .map(sessionSince)
    .filter(Number.isFinite);
  return times.length > 0 ? Math.max(...times) : undefined;
}

function dropTimes(
  prev: SlotState,
  sessions: AgentSession[],
  live: AgentSession[],
  nowMs: number,
  options: SlotOptions,
) {
  const liveIds = new Set(live.map((s) => s.sessionId));
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const drops = new Map<string, number>();
  for (const [sessionId, projectId] of prev.prevLive) {
    if (liveIds.has(sessionId)) continue;
    const session = byId.get(sessionId);
    const last = session?.lastActivity === undefined ? Number.NaN : Date.parse(session.lastActivity);
    const timeout = session?.state === "waiting" ? options.waitingMs : options.idleMs;
    const at = Number.isFinite(last) ? Math.min(nowMs, last + timeout) : nowMs;
    drops.set(projectId, Math.max(drops.get(projectId) ?? at, at));
  }
  return drops;
}

function keepOrFree(brain: BrainView, active: Map<string, ActiveProject>, since: Since): BrainView {
  if (!brain.project) return brain;
  const found = active.get(brain.project.id);
  if (!found)
    return {
      ...freeBrain(brain.number - 1),
      stateSince: iso(since.drops.get(brain.project.id) ?? since.nowMs),
    };
  if (found.state === brain.state) return { ...brain, project: found.project };
  const drop = since.drops.get(brain.project.id);
  const base = latestSince(since, brain.project.id, found.state);
  const prevSince = brain.stateSince === null ? Number.NEGATIVE_INFINITY : Date.parse(brain.stateSince);
  const candidates = [base, drop].filter((t): t is number => t !== undefined);
  const at = candidates.length > 0 ? Math.max(...candidates, prevSince) : Math.max(since.nowMs, prevSince);
  return { ...brain, state: found.state, stateSince: iso(at), project: found.project };
}

function unassigned(brains: BrainView[], active: Map<string, ActiveProject>): ActiveProject[] {
  const held = new Set(brains.map((b) => b.project?.id));
  return [...active.values()]
    .filter((p) => !held.has(p.project.id))
    .sort((a, b) => b.activity - a.activity || (a.project.id < b.project.id ? -1 : 1));
}

function assign(brains: BrainView[], queue: ActiveProject[], since: Since): BrainView[] {
  const waiting = [...queue];
  return brains.map((brain) => {
    if (brain.project) return brain;
    const next = waiting.shift();
    if (!next) return brain;
    const base = latestSince(since, next.project.id, next.state) ?? since.nowMs;
    const at = since.started ? Math.max(base, since.nowMs) : base;
    return { ...brain, state: next.state, stateSince: iso(at), project: next.project };
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
  const since: Since = {
    live,
    drops: dropTimes(prev, sessions, live, nowMs, options),
    nowMs,
    started: prev.started,
  };
  const kept = prev.brains.map((b) => keepOrFree(b, active, since));
  const brains = assign(kept, unassigned(kept, active), since);
  return {
    brains,
    prevLive: new Map(live.map((s) => [s.sessionId, s.projectId])),
    started: true,
  };
}
