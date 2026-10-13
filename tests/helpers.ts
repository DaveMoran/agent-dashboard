import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const FIXTURES = path.resolve(import.meta.dir, "..", "fixtures");

const created: string[] = [];

/** Copy a fixture directory (relative to fixtures/) into a fresh temp dir. */
export async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "av-fixture-"));
  await cp(path.join(FIXTURES, name), dir, { recursive: true });
  created.push(dir);
  // Resolve symlinks (macOS /var -> /private/var) so roots are real paths.
  return await realpath(dir);
}

export async function cleanupFixtures(): Promise<void> {
  while (created.length > 0) {
    const dir = created.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
}
