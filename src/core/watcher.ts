import { statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { Adapter, RepoContext, WatchTarget } from "./adapter";
import type { Issue, Snapshot } from "./model";
import { emptySnapshot, scan, type ScanStage } from "./scan";

export type Notification =
  | { type: "initial"; snapshot: Snapshot }
  | { type: "spec-changed"; snapshot: Snapshot }
  | {
      type: "error";
      error: { stage: ScanStage; message: string };
      snapshot: Snapshot;
    };

export interface SpecWatcher {
  /** Last good snapshot. */
  current(): Snapshot;
  stop(): Promise<void>;
}

export interface WatchOptions {
  adapter: Adapter | null;
  ctx: RepoContext;
  onNotification: (n: Notification) => void;
  debounceMs?: number;
  maxWaitMs?: number;
}

function inIgnoredDir(rel: string): boolean {
  return rel
    .split(path.sep)
    .some((segment) => segment === ".git" || segment === "node_modules");
}

function isDirectory(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

export async function watchSpecs(options: WatchOptions): Promise<SpecWatcher> {
  const { adapter, ctx, onNotification } = options;
  const debounceMs = options.debounceMs ?? 150;
  const maxWaitMs = options.maxWaitMs ?? 2000;

  let current: Snapshot = emptySnapshot(adapter?.name ?? null);
  let hasGood = false;
  let targets: WatchTarget[] = [];
  let stopped = false;
  let scanning: Promise<void> | null = null;
  let rescan = false;
  let initialising = true;
  let discovered = false;
  let dirtyDuringInitial = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  const watchers: FSWatcher[] = [];
  const watchIssues: Issue[] = [];

  // Remember the patterns from every scan so new targets are honored without a restart.
  const tracked: Adapter | null = adapter && {
    ...adapter,
    discover: async (c) => {
      const found = await adapter.discover(c);
      targets = found;
      discovered = true;
      return found;
    },
  };

  const emit = (n: Notification) => {
    if (!stopped) onNotification(n);
  };

  async function runScan(kind: "initial" | "spec-changed"): Promise<void> {
    const result = await scan(tracked, ctx);
    if (result.ok) {
      const snapshot = result.snapshot;
      if (watchIssues.length > 0) snapshot.issues = [...snapshot.issues, ...watchIssues];
      current = snapshot;
      hasGood = true;
      emit({ type: kind, snapshot });
    } else {
      emit({
        type: "error",
        error: result.error,
        snapshot: hasGood ? current : emptySnapshot(adapter?.name ?? null),
      });
    }
  }

  function trigger(): void {
    if (stopped) return;
    if (scanning) {
      rescan = true;
      return;
    }
    scanning = (async () => {
      try {
        do {
          rescan = false;
          await runScan("spec-changed");
        } while (rescan && !stopped);
      } finally {
        scanning = null;
      }
    })();
  }

  function clearTimers(): void {
    if (quietTimer) clearTimeout(quietTimer);
    if (maxTimer) clearTimeout(maxTimer);
    quietTimer = null;
    maxTimer = null;
  }

  function fire(): void {
    clearTimers();
    trigger();
  }

  function onChange(): void {
    if (stopped) return;
    if (initialising) {
      dirtyDuringInitial = true;
      return;
    }
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(fire, debounceMs);
    if (!maxTimer) maxTimer = setTimeout(fire, maxWaitMs);
  }

  function relevant(root: string, filename: string | null): boolean {
    if (filename === null) return true;
    if (inIgnoredDir(filename)) return false;
    if (!discovered) return true; // patterns not known yet: be safe
    const rel = filename.split(path.sep).join("/");
    for (const target of targets) {
      if (target.root !== root) continue;
      if (target.patterns.some((p) => new Bun.Glob(p).match(rel))) return true;
    }
    return isDirectory(path.join(root, filename));
  }

  function recordWatchError(root: string, err: unknown): void {
    watchIssues.push({
      kind: "unreadable-path",
      message: `Cannot watch ${root}: ${err instanceof Error ? err.message : String(err)}`,
    });
    onChange();
  }

  function startWatchers(): void {
    if (adapter === null) return;
    for (const root of ctx.roots) {
      try {
        const w = watch(root, { recursive: true }, (_event, filename) => {
          if (relevant(root, filename === null ? null : String(filename))) onChange();
        });
        w.on("error", (err) => recordWatchError(root, err));
        watchers.push(w);
      } catch (err) {
        watchIssues.push({
          kind: "unreadable-path",
          message: `Cannot watch ${root}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Start the OS watchers before the initial scan so no change is missed. Events that
  // arrive during that scan are remembered and answered with one follow-up scan.
  startWatchers();
  await runScan("initial");
  initialising = false;
  if (dirtyDuringInitial) trigger();

  return {
    current: () => current,
    async stop() {
      stopped = true;
      clearTimers();
      for (const w of watchers) w.close();
      watchers.length = 0;
      if (scanning) await scanning;
    },
  };
}
