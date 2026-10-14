import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Adapter, RepoContext, WatchTarget } from "../../core/adapter";
import type { Spec } from "../../core/model";
import { groupFeatureFiles, parseFeatureDirName, type FeatureCopy } from "./feature-dir";
import { deriveStatus } from "./status";
import { parseTasks } from "./tasks";
import { parseTitle } from "./title";

/** A Spec whose title may be missing; the core reports `missing-title` and falls back to the id. */
type RawSpec = Omit<Spec, "title"> & { title?: string };

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function rootHasSpecKit(root: string): Promise<boolean> {
  if (await isDirectory(path.join(root, ".specify"))) return true;
  let names: string[];
  try {
    names = await readdir(path.join(root, "specs"));
  } catch {
    return false;
  }
  for (const name of names) {
    if (parseFeatureDirName(name) === null) continue;
    if (await isFile(path.join(root, "specs", name, "spec.md"))) return true;
  }
  return false;
}

export const speckitAdapter: Adapter = {
  name: "speckit",

  async detect(ctx: RepoContext): Promise<boolean> {
    try {
      for (const root of ctx.roots) {
        if (await rootHasSpecKit(root)) return true;
      }
    } catch {
      // Treat any filesystem error as "not present".
    }
    return false;
  },

  async discover(ctx: RepoContext): Promise<WatchTarget[]> {
    return ctx.roots.map((root) => ({ root, patterns: ["specs/*/**"] }));
  },

  async parse(ctx: RepoContext, files: string[]): Promise<RawSpec[]> {
    const chosen = new Map<string, FeatureCopy>();
    for (const copy of groupFeatureFiles(ctx.roots, files)) {
      if (!chosen.has(copy.dirName)) chosen.set(copy.dirName, copy);
    }

    const specs: Array<{ dirName: string; spec: RawSpec }> = [];
    for (const copy of chosen.values()) {
      const dir = `specs/${copy.dirName}`;
      const specMd = await Bun.file(path.join(copy.root, dir, "spec.md")).text();
      const hasTasks = copy.files.includes(`${dir}/tasks.md`);
      const tasks = hasTasks
        ? parseTasks(await Bun.file(path.join(copy.root, dir, "tasks.md")).text())
        : [];
      const title = parseTitle(specMd);
      const spec: RawSpec = {
        id: copy.id,
        ...(title === null ? {} : { title }),
        status: deriveStatus({
          hasPlan: copy.files.includes(`${dir}/plan.md`),
          hasTasks,
          tasks,
          merged: false,
        }),
        dependsOn: [],
        tasks,
        artifacts: copy.files,
        branch: copy.dirName,
        source: { root: copy.root },
      };
      specs.push({ dirName: copy.dirName, spec });
    }

    return specs
      .sort((a, b) =>
        a.spec.id < b.spec.id ? -1 : a.spec.id > b.spec.id ? 1 : a.dirName < b.dirName ? -1 : a.dirName > b.dirName ? 1 : 0,
      )
      .map((s) => s.spec);
  },
};
