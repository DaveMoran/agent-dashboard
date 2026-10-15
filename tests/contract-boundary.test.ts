import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = /(server\/|agents\/|core\/|adapters\/|git\/)/;

export function forbiddenImports(source: string): string[] {
  const found: string[] = [];
  const re = /(?:\bimport\b|\bexport\b)[^;'"]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of source.matchAll(re)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec && FORBIDDEN.test(spec)) found.push(spec);
  }
  return found;
}

describe("contract boundary", () => {
  test("src/contract files import nothing from server, agents, core, adapters or git", () => {
    const dir = join(import.meta.dir, "..", "src", "contract");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(forbiddenImports(readFileSync(join(dir, f), "utf8"))).toEqual([]);
    }
  });

  test("the checker catches a forbidden import", () => {
    expect(forbiddenImports('import x from "../server/routes";')).toEqual(["../server/routes"]);
  });
});
