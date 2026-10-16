import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  RepoNotDirectoryError,
  RepoNotFoundError,
  RepoNotReadableError,
  resolveRepoPath,
} from "../src/server/repo.js";

let base: string; // realpath of a fresh temp dir (macOS /var -> /private/var)

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "repo-test-")));
});

afterEach(() => {
  fs.chmodSync(base, 0o755);
  for (const entry of fs.readdirSync(base)) {
    try {
      fs.chmodSync(path.join(base, entry), 0o755);
    } catch {}
  }
  fs.rmSync(base, { recursive: true, force: true });
});

test("existing directory resolves to its real path and basename", async () => {
  const dir = path.join(base, "my-app");
  fs.mkdirSync(dir);
  expect(await resolveRepoPath(dir)).toEqual({ path: dir, name: "my-app" });
});

test("relative path resolves against cwd", async () => {
  const dir = path.join(base, "rel-app");
  fs.mkdirSync(dir);
  const relative = path.relative(process.cwd(), dir);
  expect(path.isAbsolute(relative)).toBe(false);
  expect(await resolveRepoPath(relative)).toEqual({ path: dir, name: "rel-app" });
});

test("trailing slash is removed from the result", async () => {
  const dir = path.join(base, "slash-app");
  fs.mkdirSync(dir);
  const result = await resolveRepoPath(`${dir}/`);
  expect(result.path).toBe(dir);
  expect(result.path.endsWith("/")).toBe(false);
});

test("symlink to a directory resolves to the real directory", async () => {
  const real = path.join(base, "real-app");
  const link = path.join(base, "link-app");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link);
  expect(await resolveRepoPath(link)).toEqual({ path: real, name: "real-app" });
});

test("leading ~ expands to the home directory", async () => {
  const result = await resolveRepoPath("~");
  expect(result.path).toBe(fs.realpathSync(os.homedir()));
});

test("missing path throws RepoNotFoundError naming the path", async () => {
  const missing = path.join(base, "does-not-exist");
  const error = await resolveRepoPath(missing).catch((e) => e);
  expect(error).toBeInstanceOf(RepoNotFoundError);
  expect(error.message).toContain(missing);
  expect(error.exitCode).toBe(1);
});

test("a file throws RepoNotDirectoryError naming the path", async () => {
  const file = path.join(base, "file.txt");
  fs.writeFileSync(file, "x");
  const error = await resolveRepoPath(file).catch((e) => e);
  expect(error).toBeInstanceOf(RepoNotDirectoryError);
  expect(error.message).toContain(file);
  expect(error.message).toContain("not a directory");
});

test.skipIf(process.getuid?.() === 0)(
  "unreadable directory throws RepoNotReadableError naming the path",
  async () => {
    const dir = path.join(base, "locked");
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o000);
    try {
      const error = await resolveRepoPath(dir).catch((e) => e);
      expect(error).toBeInstanceOf(RepoNotReadableError);
      expect(error.message).toContain(dir);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  },
);
