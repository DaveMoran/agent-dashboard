import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Adapter, RepoContext } from "./adapter";
import type { Issue, Snapshot } from "./model";
import { validateSpecs } from "./validate";

export type ScanStage = "discover" | "parse";

export type ScanResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; error: { stage: ScanStage; message: string } };

export function isIgnoredPath(rel: string): boolean {
  const p = "/" + rel.split(path.sep).join("/");
  return p.includes("/.git/") || p.includes("/node_modules/");
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function emptySnapshot(adapter: string | null = null): Snapshot {
  return { specs: [], issues: [], adapter, scannedAt: new Date().toISOString() };
}

export async function scan(
  adapter: Adapter | null,
  ctx: RepoContext,
): Promise<ScanResult> {
  if (adapter === null) {
    return { ok: true, snapshot: emptySnapshot(null) };
  }

  let targets;
  try {
    targets = await adapter.discover(ctx);
  } catch (err) {
    return { ok: false, error: { stage: "discover", message: messageOf(err) } };
  }

  const issues: Issue[] = [];
  const files = new Set<string>();
  for (const target of targets) {
    try {
      await readdir(target.root);
    } catch (err) {
      issues.push({
        kind: "unreadable-path",
        message: `Cannot read ${target.root}: ${messageOf(err)}`,
      });
      continue;
    }
    for (const pattern of target.patterns) {
      try {
        const glob = new Bun.Glob(pattern);
        for await (const rel of glob.scan({
          cwd: target.root,
          onlyFiles: true,
          dot: true,
        })) {
          if (isIgnoredPath(rel)) continue;
          files.add(path.join(target.root, rel));
        }
      } catch (err) {
        issues.push({
          kind: "unreadable-path",
          message: `Cannot scan ${target.root} for "${pattern}": ${messageOf(err)}`,
        });
      }
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

  const validated = validateSpecs(raw);
  return {
    ok: true,
    snapshot: {
      specs: validated.specs,
      issues: [...issues, ...validated.issues],
      adapter: adapter.name,
      scannedAt: new Date().toISOString(),
    },
  };
}
