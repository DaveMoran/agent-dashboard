import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Adapter, RepoContext, WatchTarget } from "./adapter";
import type { Issue, Snapshot } from "./model";
import { validateSpecs } from "./validate";

export type ScanStage = "discover" | "parse";

export type ScanResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; error: { stage: ScanStage; message: string } };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const PRUNED_DIRS = new Set([".git", "node_modules"]);

/** Relative paths (using "/") of every file under root, never entering pruned dirs. */
async function walk(root: string, issues: Issue[]): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string, rel: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      issues.push({
        kind: "unreadable-path",
        message: `Cannot read ${dir}: ${messageOf(err)}`,
      });
      return;
    }
    for (const entry of entries) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!PRUNED_DIRS.has(entry.name)) await visit(path.join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        files.push(childRel);
      }
    }
  }
  await visit(root, "");
  return files;
}

export function emptySnapshot(adapter: string | null = null): Snapshot {
  return { specs: [], issues: [], adapter, scannedAt: new Date().toISOString() };
}

export async function scan(adapter: Adapter | null, ctx: RepoContext): Promise<ScanResult> {
  if (adapter === null) {
    return { ok: true, snapshot: emptySnapshot(null) };
  }

  let targets: WatchTarget[];
  try {
    targets = await adapter.discover(ctx);
  } catch (err) {
    return { ok: false, error: { stage: "discover", message: messageOf(err) } };
  }

  const issues: Issue[] = [];
  const files = new Set<string>();
  for (const target of targets) {
    const relFiles = await walk(target.root, issues);
    const globs = target.patterns.map((p) => new Bun.Glob(p));
    for (const rel of relFiles) {
      if (globs.some((g) => g.match(rel))) files.add(path.join(target.root, rel));
    }
  }

  let raw: unknown[];
  try {
    const parsed: unknown = await adapter.parse(ctx, [...files].sort());
    if (!Array.isArray(parsed)) {
      throw new Error("adapter.parse must return an array");
    }
    raw = parsed;
  } catch (err) {
    return { ok: false, error: { stage: "parse", message: messageOf(err) } };
  }

  // The same unreadable path can be reached through several targets; report it once.
  const uniqueIssues = issues.filter(
    (issue, i) => issues.findIndex((o) => o.message === issue.message) === i,
  );

  const validated = validateSpecs(raw);
  return {
    ok: true,
    snapshot: {
      specs: validated.specs,
      issues: [...uniqueIssues, ...validated.issues],
      adapter: adapter.name,
      scannedAt: new Date().toISOString(),
    },
  };
}
