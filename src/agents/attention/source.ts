import { existsSync } from "node:fs";
import type { SessionState } from "../../contract/sessions";
import type { AgentSession, AgentSource, AgentSourceEvent, IngestIssue } from "../source";
import { FileTail } from "../transcripts/tail";
import type { createTranscriptSource } from "../transcripts/source";
import { type AttentionRecord, applyHookEvent, combinedState, emptyRecord, waitSince } from "./combine";
import { classifyHookLine } from "./hook-line";

export interface AttentionSourceOptions {
  base: AgentSource & Pick<ReturnType<typeof createTranscriptSource>, "clears" | "onActivity">;
  eventsFile: string;
  pollIntervalMs?: number;
  holdMs?: number;
  now?: () => number;
}

export interface HookStatus {
  seen: boolean;
  lastEventAt: string | null;
}

const MAX_ISSUES = 200;

interface Reported {
  state: SessionState;
  since: string | undefined;
}

export function createAttentionSource(options: AttentionSourceOptions): AgentSource & {
  refresh(): Promise<void>;
  hookStatus(): HookStatus;
} {
  const { base, eventsFile } = options;
  const pollMs = options.pollIntervalMs ?? 500;
  const now = options.now ?? Date.now;

  const tail = new FileTail(eventsFile);
  const records = new Map<string, AttentionRecord>();
  const reported = new Map<string, Reported>();
  const ownIssues: IngestIssue[] = [];
  const listeners = new Set<(event: AgentSourceEvent) => void>();
  let seen = false;
  let lastEventAt: string | null = null;
  let active = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inflight: Promise<void> | undefined;
  let unsubs: Array<() => void> = [];

  function emit(event: AgentSourceEvent): void {
    if (!active) return;
    for (const l of [...listeners]) l(event);
  }

  function baseSession(id: string): AgentSession | undefined {
    return base.sessions().find((s) => s.sessionId === id);
  }

  function combine(session: AgentSession): { state: SessionState; since: string | undefined } {
    const id = session.sessionId;
    const record = records.get(id) ?? emptyRecord();
    const clears = base.clears(id);
    const state = combinedState(session.state, record, clears);
    const last = reported.get(id);
    if (last !== undefined && last.state === state) return { state, since: last.since };
    if (state === session.state) return { state, since: session.stateSince };
    return { state, since: waitSince(record, clears) ?? session.stateSince };
  }

  function view(session: AgentSession): AgentSession {
    const c = combine(session);
    return { ...session, state: c.state, stateSince: c.since };
  }

  function recompute(sessionId: string, at: string): void {
    const session = baseSession(sessionId);
    if (session === undefined) return;
    const last = reported.get(sessionId);
    const c = combine(session);
    if (last === undefined) {
      reported.set(sessionId, { state: c.state, since: c.since });
      return;
    }
    if (c.state === last.state) return;
    reported.set(sessionId, { state: c.state, since: at });
    emit({
      type: "state-changed",
      sessionId,
      projectId: session.projectId,
      from: last.state,
      to: c.state,
      at,
      session: { ...session, state: c.state, stateSince: at },
    });
  }

  function onBaseEvent(event: AgentSourceEvent): void {
    switch (event.type) {
      case "session-added": {
        const v = view(event.session);
        reported.set(event.session.sessionId, { state: v.state, since: v.stateSince });
        emit({ type: "session-added", session: v });
        return;
      }
      case "session-updated":
        emit({ type: "session-updated", session: view(event.session) });
        return;
      case "state-changed":
        recompute(event.sessionId, event.at);
        return;
      case "session-ended":
        reported.delete(event.sessionId);
        emit(event);
        return;
    }
  }

  function addIssue(issue: IngestIssue): void {
    if (ownIssues.length < MAX_ISSUES) ownIssues.push(issue);
  }

  async function readEvents(): Promise<void> {
    if (!existsSync(eventsFile)) return;
    let result: Awaited<ReturnType<FileTail["read"]>>;
    try {
      result = await tail.read();
    } catch (err) {
      if (!existsSync(eventsFile)) return;
      addIssue({
        file: eventsFile,
        offset: 0,
        reason: "unreadable",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (result.reset) {
      records.clear();
      seen = false;
      lastEventAt = null;
    }
    for (const line of result.lines) {
      const r = classifyHookLine(line.text);
      if ("issue" in r) {
        addIssue({
          file: eventsFile,
          offset: line.offset,
          reason: r.issue.reason,
          detail: r.issue.reason === "missing-field" ? r.issue.field : undefined,
        });
        continue;
      }
      const ev = r.event;
      seen = true;
      if (lastEventAt === null || Date.parse(ev.ts) > Date.parse(lastEventAt)) lastEventAt = ev.ts;
      records.set(ev.sessionId, applyHookEvent(records.get(ev.sessionId) ?? emptyRecord(), ev));
      recompute(ev.sessionId, ev.ts);
    }
  }

  function refresh(): Promise<void> {
    if (inflight !== undefined) return inflight;
    const run = readEvents().finally(() => {
      if (inflight === run) inflight = undefined;
    });
    inflight = run;
    return run;
  }

  return {
    name: "attention",
    refresh,
    hookStatus: () => ({ seen, lastEventAt }),
    async start(): Promise<void> {
      if (active) return;
      active = true;
      unsubs = [
        base.subscribe(onBaseEvent),
        base.onActivity((id) => {
          if (active) recompute(id, base.clears(id)?.lastTurnAt ?? new Date(now()).toISOString());
        }),
      ];
      await base.start();
      for (const s of base.sessions()) {
        if (!reported.has(s.sessionId)) {
          const v = view(s);
          reported.set(s.sessionId, { state: v.state, since: v.stateSince });
        }
      }
      await refresh();
      if (active && pollMs > 0 && timer === undefined) {
        timer = setInterval(() => {
          refresh().catch(() => {});
        }, pollMs);
      }
    },
    async stop(): Promise<void> {
      active = false;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      for (const u of unsubs) u();
      unsubs = [];
      if (inflight !== undefined) await inflight.catch(() => {});
      await base.stop();
    },
    sessions: () => base.sessions().map(view),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    issues: () => [...base.issues(), ...ownIssues].slice(0, MAX_ISSUES),
  };
}
