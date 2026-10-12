import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type InstanceRecord,
  StateDirError,
  instancePath,
  isLive,
  readInstance,
  removeInstance,
  repoKey,
  stateRoot,
  writeInstance,
} from "../src/server/state.js";
import { startServer } from "../src/server/start.js";

let tmp: string;
let repoDir: string;
let savedEnv: string | undefined;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "state-test-")));
  repoDir = path.join(tmp, "My App");
  fs.mkdirSync(repoDir);
  savedEnv = process.env.AGENT_VISUALIZER_STATE_DIR;
  process.env.AGENT_VISUALIZER_STATE_DIR = path.join(tmp, "state");
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.AGENT_VISUALIZER_STATE_DIR;
  else process.env.AGENT_VISUALIZER_STATE_DIR = savedEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function record(overrides: Partial<InstanceRecord> = {}): InstanceRecord {
  return {
    port: 4318,
    pid: 48213,
    repoPath: repoDir,
    startedAt: "2026-10-12T14:03:22.114Z",
    version: "0.1.0",
    ...overrides,
  };
}

test("stateRoot honours AGENT_VISUALIZER_STATE_DIR and defaults to ~/.agent-visualizer", () => {
  expect(stateRoot()).toBe(path.join(tmp, "state"));
  delete process.env.AGENT_VISUALIZER_STATE_DIR;
  expect(stateRoot()).toBe(path.join(os.homedir(), ".agent-visualizer"));
});

test("repoKey is slug-of-basename plus 8 hex chars of sha1(path)", () => {
  // hashes computed independently: printf '%s' <path> | shasum | cut -c1-8
  expect(repoKey("/Users/me/Sites/My App")).toBe("my-app-860cbac8");
  expect(repoKey("/a/Foo__Bar.baz")).toBe("foo-bar-baz-fdc99031");
});

test("different repos get different keys, same repo the same key", () => {
  expect(repoKey("/a/app")).not.toBe(repoKey("/b/app"));
  expect(repoKey("/a/app")).toBe(repoKey("/a/app"));
});

test("record round-trips and lives under instances/<key>/server.json", async () => {
  await writeInstance(record());
  const file = path.join(tmp, "state", "instances", repoKey(repoDir), "server.json");
  expect(instancePath(repoDir)).toBe(file);
  expect(fs.existsSync(file)).toBe(true);
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(record());
  expect(await readInstance(repoDir)).toEqual(record());
});

test("state directories are created with mode 0700 and no temp files remain", async () => {
  await writeInstance(record());
  const dir = path.dirname(instancePath(repoDir));
  expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  expect(fs.readdirSync(dir)).toEqual(["server.json"]);
});

test("writeInstance replaces an existing record", async () => {
  await writeInstance(record({ port: 1111 }));
  await writeInstance(record({ port: 2222 }));
  expect((await readInstance(repoDir))?.port).toBe(2222);
});

test("readInstance returns null when missing, corrupt, or the wrong shape", async () => {
  expect(await readInstance(repoDir)).toBeNull();
  const file = instancePath(repoDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{ not json");
  expect(await readInstance(repoDir)).toBeNull();
  fs.writeFileSync(file, JSON.stringify({ port: "x" }));
  expect(await readInstance(repoDir)).toBeNull();
});

test("removeInstance with a non-matching pid leaves the file", async () => {
  await writeInstance(record({ pid: 100 }));
  expect(removeInstance(repoDir, 999)).toBe(false);
  expect(fs.existsSync(instancePath(repoDir))).toBe(true);
});

test("removeInstance with the matching pid deletes the file", async () => {
  await writeInstance(record({ pid: 100 }));
  expect(removeInstance(repoDir, 100)).toBe(true);
  expect(fs.existsSync(instancePath(repoDir))).toBe(false);
});

test("removeInstance on a missing record is a harmless no-op", () => {
  expect(removeInstance(repoDir, 1)).toBe(false);
});

test("isLive is false for a pid that has exited", async () => {
  const child = Bun.spawn(["true"]);
  await child.exited;
  expect(await isLive(record({ pid: child.pid }))).toBe(false);
});

test("isLive is false when the pid is alive but nothing listens on the port", async () => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const closed = probe.port as number;
  await probe.stop(true);
  expect(await isLive(record({ pid: process.pid, port: closed }))).toBe(false);
});

test("isLive is false when the port answers for a different repo", async () => {
  const other = path.join(tmp, "other");
  fs.mkdirSync(other);
  const server = await startServer({
    repo: { path: other, name: "other" },
    port: 0,
    webRoot: tmp,
  });
  try {
    expect(await isLive(record({ pid: process.pid, port: server.port }))).toBe(false);
  } finally {
    await server.stop();
  }
});

test("isLive is true for a live startServer instance of the same repo", async () => {
  const server = await startServer({
    repo: { path: repoDir, name: "My App" },
    port: 0,
    webRoot: tmp,
  });
  try {
    expect(await isLive(record({ pid: process.pid, port: server.port }))).toBe(true);
  } finally {
    await server.stop();
  }
});

test("an unwritable state dir throws StateDirError naming the directory", async () => {
  const blocker = path.join(tmp, "blocker");
  fs.writeFileSync(blocker, "i am a file");
  process.env.AGENT_VISUALIZER_STATE_DIR = path.join(blocker, "state");
  const error = await writeInstance(record()).catch((e) => e);
  expect(error).toBeInstanceOf(StateDirError);
  expect(error.exitCode).toBe(1);
  expect(error.message).toContain(path.dirname(instancePath(repoDir)));
});
