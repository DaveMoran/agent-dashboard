import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Adapter, RepoContext, WatchTarget } from "../../src/core/adapter";

export interface StubOptions {
  name?: string;
  detect?: boolean | "throw";
  patterns?: string[];
  /** Wait this long after reading the files and before parsing them. */
  parseDelayMs?: number;
}

async function isDir(p: string): Promise<boolean> {
  try {
    await readdir(p);
    return true;
  } catch {
    return false;
  }
}

export function createStubAdapter(options: StubOptions = {}): Adapter {
  const patterns = options.patterns ?? ["stub-specs/*.json"];
  return {
    name: options.name ?? "stub",
    async detect(ctx: RepoContext) {
      if (options.detect === "throw") throw new Error("stub detect failure");
      if (typeof options.detect === "boolean") return options.detect;
      for (const root of ctx.roots) {
        if (await isDir(path.join(root, "stub-specs"))) return true;
      }
      return false;
    },
    async discover(ctx: RepoContext): Promise<WatchTarget[]> {
      return ctx.roots.map((root) => ({ root, patterns: [...patterns] }));
    },
    async parse(ctx: RepoContext, files: string[]) {
      const texts: string[] = [];
      for (const file of files) texts.push(await readFile(file, "utf8"));
      if (options.parseDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.parseDelayMs));
      }
      const out: unknown[] = [];
      for (const [i, file] of files.entries()) {
        const text = texts[i]!;
        if (text.trim() === "FAIL") {
          throw new Error(`stub parse failure in ${file}`);
        }
        const value: unknown = JSON.parse(text);
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const obj = value as Record<string, unknown>;
          if (!("source" in obj)) {
            const root = ctx.roots.find((r) => file.startsWith(r + path.sep));
            if (root !== undefined) obj.source = { root };
          }
        }
        out.push(value);
      }
      return out;
    },
  };
}
