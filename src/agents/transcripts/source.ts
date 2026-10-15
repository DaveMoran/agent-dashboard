import { stat } from "node:fs/promises";
import path from "node:path";
import type { SessionState } from "../../contract/sessions";
import type { AgentSession, AgentSource, AgentSourceEvent, IngestIssue } from "../source";
import { classifyLine } from "./entry";
import { listSessionFiles, listSubagentFiles } from "./discover";
import { createProjectResolver, type ProjectRef } from "./project";
import { applyEntry, initialSessionState, type SessionStateT } from "./session-state";
import { combineState, isSubagentRunning } from "./subagents";
import { FileTail, type TailLine } from "./tail";

export interface TranscriptSourceOptions {
  root: string;
  mainAgentPattern: RegExp;
  pollIntervalMs?: number;
  tailWindowBytes?: number;
  resolveProject?: (cwd: string) => Promise<ProjectRef>;
}

const DEFAULT_POLL_MS = 500;
const DEFAULT_WINDOW = 2 * 1024 * 1024;
const MAX_ISSUES = 200;

interface Track {
  tail: FileTail;
  state: SessionStateT;
  /** True once a first read has succeeded. */
  read: boolean;
  /** True while the last read failed (so an unreadable file is reported once). */
  failing: boolean;
}

interface FileRec {
  file: string;
  main: Track;
  subs: Map<string, Track>;
  project: ProjectRef | undefined;
  projectCwd: string | undefined;
  announced: boolean;
  addedEmitted: boolean;
  reported: AgentSession | undefined;
  combinedState: SessionState;
  combinedSince: string | undefined;
}

function newTrack(file: string): Track {
  return { tail: new FileTail(file), state: initialSessionState(), read: false, failing: false };
}

function maxTime(a: string | undefined, b: string | undefined): string | undefined {
  if (b === undefined) return a;
  if (a === undefined) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

export function createTranscriptSource(options: TranscriptSourceOptions): AgentSource & {
  refresh(): Promise<void>;
} {
  const root = options.root;
  const pattern = options.mainAgentPattern;
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const windowBytes = options.tailWindowBytes ?? DEFAULT_WINDOW;
  const resolveProject = options.resolveProject ?? createProjectResolver();

  const recs = new Map<string, FileRec>();
  const listeners = new Set<(event: AgentSourceEvent) => void>();
  const issueLog: IngestIssue[] = [];
  let active = false;
  let startPromise: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inflight: Promise<void> | undefined;

  function addIssue(issue: IngestIssue): void {
    issueLog.push(issue);
    if (issueLog.length > MAX_ISSUES) issueLog.splice(0, issueLog.length - MAX_ISSUES);
  }

  function emit(event: AgentSourceEvent): void {
    if (!active) return;
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try {
        listener(event);
      } catch {
        // listeners own their errors
      }
    }
  }

  function sessionIdOf(rec: FileRec): string {
    return rec.main.state.sessionId ?? path.basename(rec.file, ".jsonl");
  }

  function countRunning(rec: FileRec): number {
    let n = 0;
    for (const [agentId, sub] of rec.subs) {
      if (isSubagentRunning(agentId, sub.state, rec.main.state)) n += 1;
    }
    return n;
  }

  /** Track the combined state and the timestamp of the entry that last changed it. */
  function updateCombined(rec: FileRec, at: string | undefined): void {
    const next = combineState(rec.main.state.state, countRunning(rec));
    if (next !== rec.combinedState) {
      rec.combinedState = next;
      rec.combinedSince = at;
    }
  }

  function build(rec: FileRec): AgentSession {
    const s = rec.main.state;
    let lastActivity = s.lastActivity;
    for (const sub of rec.subs.values()) lastActivity = maxTime(lastActivity, sub.state.lastActivity);
    const cwd = s.cwd;
    const model = s.model;
    pattern.lastIndex = 0;
    const isMain = cwd !== undefined && model !== undefined && pattern.test(model);
    return {
      sessionId: sessionIdOf(rec),
      source: "transcripts",
      projectId: cwd === undefined ? "" : (rec.project?.id ?? ""),
      projectName: cwd === undefined ? "" : (rec.project?.name ?? ""),
      cwd,
      model,
      isMain,
      state: rec.combinedState,
      runningSubagents: countRunning(rec),
      stateSince: rec.combinedSince,
      lastActivity,
    };
  }

  async function ensureProject(rec: FileRec): Promise<void> {
    const cwd = rec.main.state.cwd;
    if (cwd === undefined) {
      rec.project = undefined;
      rec.projectCwd = undefined;
      return;
    }
    if (rec.projectCwd === cwd && rec.project !== undefined) return;
    try {
      rec.project = await resolveProject(cwd);
    } catch {
      rec.project = { id: cwd, name: path.basename(cwd), inGit: false };
    }
    rec.projectCwd = cwd;
  }

  /** Among announced records sharing a session id, the one with the latest activity is visible (R8). */
  function isVisible(rec: FileRec): boolean {
    const id = rec.reported?.sessionId;
    if (id === undefined) return false;
    let best: FileRec | undefined;
    for (const other of recs.values()) {
      if (other.reported === undefined || other.reported.sessionId !== id) continue;
      if (
        best === undefined ||
        Date.parse(other.reported.lastActivity ?? "") > Date.parse(best.reported!.lastActivity ?? "")
      ) {
        best = other;
      }
    }
    return best === rec;
  }

  /** Recompute the session, remember it, and emit what changed since the last report. */
  async function report(rec: FileRec, at: string | undefined): Promise<void> {
    await ensureProject(rec);
    const next = build(rec);
    const prev = rec.reported;
    rec.reported = next;
    if (prev === undefined || !active || !rec.addedEmitted || !isVisible(rec)) return;
    if (next.state !== prev.state) {
      emit({
        type: "state-changed",
        sessionId: next.sessionId,
        projectId: next.projectId,
        from: prev.state,
        to: next.state,
        at: at ?? next.lastActivity ?? "",
        session: next,
      });
    } else if (
      next.model !== prev.model ||
      next.isMain !== prev.isMain ||
      next.cwd !== prev.cwd ||
      next.projectId !== prev.projectId ||
      next.projectName !== prev.projectName ||
      next.runningSubagents !== prev.runningSubagents
    ) {
      emit({ type: "session-updated", session: next });
    }
  }

  /** Fold lines into the track's current state; report after each line unless silent. */
  async function foldLines(
    rec: FileRec,
    track: Track,
    lines: TailLine[],
    silent: boolean,
    sink: IngestIssue[],
  ): Promise<void> {
    for (const line of lines) {
      const result = classifyLine(line.text);
      if ("issue" in result) {
        sink.push({
          file: track.tail.path,
          offset: line.offset,
          reason: result.issue.reason,
          detail: result.issue.field,
        });
        continue;
      }
      const entry = result.entry;
      track.state = applyEntry(track.state, entry);
      updateCombined(rec, entry.timestamp);
      if (!silent) await report(rec, entry.timestamp ?? track.state.lastActivity);
    }
  }

  /** Throw away the track's state and rebuild it from lines, without events. */
  async function rebuild(rec: FileRec, track: Track, lines: TailLine[], sink: IngestIssue[]): Promise<void> {
    track.state = initialSessionState();
    await foldLines(rec, track, lines, true, sink);
  }

  function describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  async function firstReadWindowed(
    rec: FileRec,
    track: Track,
    isSub: boolean,
    size: number,
    silent: boolean,
  ): Promise<void> {
    const fromOffset = size - windowBytes;
    const sink: IngestIssue[] = [];
    const savedState = rec.combinedState;
    const savedSince = rec.combinedSince;

    const tail = new FileTail(track.tail.path);
    const before = await Bun.file(track.tail.path).slice(fromOffset - 1, fromOffset).bytes();
    const r = await tail.read({ fromOffset });
    // The window usually starts mid-line. Unless the byte before it is a newline, the line
    // beginning exactly at fromOffset is partial and is dropped.
    const lines =
      before[0] !== 10 && r.lines[0] !== undefined && r.lines[0].offset === fromOffset
        ? r.lines.slice(1)
        : r.lines;
    track.tail = tail;
    await rebuild(rec, track, lines, sink);
    const ok = isSub ? track.state.sawStateEntry : track.state.sawModel && track.state.sawStateEntry;

    if (!ok) {
      sink.length = 0;
      rec.combinedState = savedState;
      rec.combinedSince = savedSince;
      const full = new FileTail(track.tail.path);
      const all = await full.read();
      track.tail = full;
      await rebuild(rec, track, all.lines, sink);
    }
    for (const issue of sink) addIssue(issue);
    if (!silent) await report(rec, track.state.lastActivity);
  }

  async function readTrack(rec: FileRec, track: Track, isSub: boolean, silent: boolean): Promise<void> {
    const file = track.tail.path;
    const sink: IngestIssue[] = [];
    try {
      if (!track.read) {
        const size = (await stat(file)).size;
        if (size > windowBytes) {
          await firstReadWindowed(rec, track, isSub, size, silent);
          track.read = true;
          track.failing = false;
          return;
        }
      }
      const r = await track.tail.read();
      track.read = true;
      track.failing = false;
      if (!r.changed) return;
      if (r.reset) {
        await rebuild(rec, track, r.lines, sink);
        for (const issue of sink) addIssue(issue);
        if (!silent) await report(rec, track.state.lastActivity);
        return;
      }
      await foldLines(rec, track, r.lines, silent, sink);
      for (const issue of sink) addIssue(issue);
    } catch (err) {
      for (const issue of sink) addIssue(issue);
      if (!track.failing) {
        addIssue({ file, offset: 0, reason: "unreadable", detail: describe(err) });
      }
      track.failing = true;
    }
  }

  async function pass(): Promise<void> {
    const files = await listSessionFiles(root);
    const present = new Set(files);
    for (const file of [...recs.keys()]) if (!present.has(file)) recs.delete(file);

    for (const file of files) {
      let rec = recs.get(file);
      if (rec === undefined) {
        rec = {
          file,
          main: newTrack(file),
          subs: new Map(),
          project: undefined,
          projectCwd: undefined,
          announced: false,
          addedEmitted: false,
          reported: undefined,
          combinedState: "standby",
          combinedSince: undefined,
        };
        recs.set(file, rec);
      }
      const silent = !rec.announced;
      await readTrack(rec, rec.main, false, silent);

      if (rec.main.state.lastActivity !== undefined) {
        const found = await listSubagentFiles(file);
        const ids = new Set(found.map((f) => f.agentId));
        for (const agentId of [...rec.subs.keys()]) {
          if (!ids.has(agentId)) {
            rec.subs.delete(agentId);
            updateCombined(rec, rec.main.state.lastActivity);
          }
        }
        for (const sub of found) {
          let track = rec.subs.get(sub.agentId);
          if (track === undefined) {
            track = newTrack(sub.path);
            rec.subs.set(sub.agentId, track);
          }
          await readTrack(rec, track, true, silent);
        }
      }

      if (!rec.announced && rec.main.state.lastActivity !== undefined) {
        await ensureProject(rec);
        rec.reported = build(rec);
        rec.announced = true;
        if (isVisible(rec)) {
          rec.addedEmitted = true;
          emit({ type: "session-added", session: rec.reported });
        }
      }
    }

    // A duplicate that has become the visible file is announced now.
    for (const rec of recs.values()) {
      if (rec.announced && !rec.addedEmitted && rec.reported !== undefined && isVisible(rec)) {
        rec.addedEmitted = true;
        emit({ type: "session-added", session: rec.reported });
      }
    }
  }

  function refresh(): Promise<void> {
    if (inflight !== undefined) return inflight;
    const run = pass().finally(() => {
      if (inflight === run) inflight = undefined;
    });
    inflight = run;
    return run;
  }

  return {
    name: "transcripts",
    refresh,
    start(): Promise<void> {
      if (startPromise === undefined) {
        active = true;
        startPromise = (async () => {
          await refresh();
          if (active && pollMs > 0 && timer === undefined) {
            timer = setInterval(() => {
              refresh().catch(() => {});
            }, pollMs);
          }
        })();
      }
      return startPromise;
    },
    async stop(): Promise<void> {
      active = false;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      const pending = startPromise;
      startPromise = undefined;
      if (pending !== undefined) await pending.catch(() => {});
      if (inflight !== undefined) await inflight.catch(() => {});
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    sessions(): AgentSession[] {
      const best = new Map<string, AgentSession>();
      for (const rec of recs.values()) {
        const s = rec.reported;
        if (s === undefined) continue;
        const cur = best.get(s.sessionId);
        if (cur === undefined || Date.parse(s.lastActivity ?? "") > Date.parse(cur.lastActivity ?? "")) {
          best.set(s.sessionId, s);
        }
      }
      return [...best.values()].map((s) => ({ ...s }));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    issues: () => issueLog.map((i) => ({ ...i })),
  };
}
