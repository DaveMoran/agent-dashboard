import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const CORE = path.resolve(import.meta.dir, "..", "src", "core");
const FORBIDDEN = ["spec kit", "speckit", "spec-kit", "openspec", "bmad", ".specify"];

test("src/core/ does not mention any spec framework by name", async () => {
  const files = (await readdir(CORE)).filter((f) => f.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(0);
  const offenders: string[] = [];
  for (const file of files) {
    const text = (await readFile(path.join(CORE, file), "utf8")).toLowerCase();
    for (const word of FORBIDDEN) {
      if (text.includes(word)) offenders.push(`${file}: ${word}`);
    }
  }
  expect(offenders).toEqual([]);
});
