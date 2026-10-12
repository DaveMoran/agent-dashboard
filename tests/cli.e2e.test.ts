import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pkg from "../package.json" with { type: "json" };

const CLI = path.resolve(import.meta.dir, "../src/cli/index.ts");

let tmp: string;
let repoDir: string;
let stateDir: string;
let children: Array<ReturnType<typeof Bun.spawn>>;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cli-e2e-")));
  repoDir = path.join(tmp, "demo-repo");
  stateDir = path.join(tmp, "state");
  fs.mkdirSync(repoDir);
  children = [];
});

afterEach(() => {
  for (const child of children) child.kill("SIGKILL");
  fs.rmSync(tmp, { recursive: true, force: true });
});

function spawnCli(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(["bun", CLI, ...args], {
    cwd: tmp,
    env: { ...process.env, AGENT_VISUALIZER_STATE_DIR: stateDir, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  return child;
}

async function run(args: string[], env: Record<string, string> = {}) {
  const child = spawnCli(args, env);
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout as ReadableStream).text(),
    new Response(child.stderr as ReadableStream).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

/** Reads a stream until the line containing `marker` is complete; returns everything read so far. */
async function readUntil(stream: ReadableStream<Uint8Array>, marker: string, timeoutMs = 10_000) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  const lineDone = () => {
    const at = text.indexOf(marker);
    return at >= 0 && text.indexOf("\n", at) >= 0;
  };
  while (!lineDone()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for "${marker}"; got: ${text}`);
    const result = await Promise.race([
      reader.read(),
      Bun.sleep(remaining).then(() => "timeout" as const),
    ]);
    if (result === "timeout" || result.done) {
      throw new Error(`Stream ended before "${marker}"; got: ${text}`);
    }
    text += decoder.decode(result.value);
  }
  reader.releaseLock();
  return text;
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const port = probe.port as number;
  await probe.stop(true);
  return port;
}

test("no args exits 2 with usage on stderr", async () => {
  const { code, stdout, stderr } = await run([]);
  expect(code).toBe(2);
  expect(stdout).toBe("");
  expect(stderr).toContain("Missing repository path");
  expect(stderr).toContain("Usage: agent-visualizer <repo-path> [--port <n>]");
});

test("missing repo path exits 1 and names the path", async () => {
  const { code, stderr } = await run(["/does/not/exist"]);
  expect(code).toBe(1);
  expect(stderr).toContain("/does/not/exist");
  expect(stderr).toContain("not found");
});

test("a file path exits 1 and says not a directory", async () => {
  const file = path.join(tmp, "file.txt");
  fs.writeFileSync(file, "x");
  const { code, stderr } = await run([file]);
  expect(code).toBe(1);
  expect(stderr).toContain("not a directory");
  expect(stderr).toContain(file);
});

test("--port abc exits 2 naming the bad value", async () => {
  const { code, stderr } = await run([repoDir, "--port", "abc"]);
  expect(code).toBe(2);
  expect(stderr).toContain("abc");
});

test("unknown flag exits 2", async () => {
  const { code } = await run([repoDir, "--bogus"]);
  expect(code).toBe(2);
});

test("--help exits 0 and prints usage to stdout", async () => {
  const { code, stdout, stderr } = await run(["--help"]);
  expect(code).toBe(0);
  expect(stdout).toContain("Usage: agent-visualizer <repo-path> [--port <n>]");
  expect(stderr).toBe("");
});

test("--version exits 0 and prints the package version", async () => {
  const { code, stdout } = await run(["--version"]);
  expect(code).toBe(0);
  expect(pkg.version).toBe("0.1.0");
  expect(stdout.trim()).toBe("0.1.0");
});

test("successful start prints the three startup lines and serves health", async () => {
  const port = await freePort();
  const child = spawnCli([repoDir, "--port", String(port)]);
  const out = await readUntil(child.stdout as ReadableStream<Uint8Array>, "Listening:");
  expect(out.trimEnd().split("\n")).toEqual([
    `Agent Visualizer ${pkg.version}`,
    `Observing: ${repoDir}`,
    `Listening: http://127.0.0.1:${port}`,
  ]);
  const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  expect(health).toEqual({
    status: "ok",
    repoPath: repoDir,
    repoName: "demo-repo",
    version: pkg.version,
  });
  child.kill("SIGKILL");
});

test("--port taken: falls back, says so on stderr, and listens elsewhere", async () => {
  const occupier = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const taken = occupier.port as number;
  try {
    const child = spawnCli([repoDir, "--port", String(taken)]);
    const out = await readUntil(child.stdout as ReadableStream<Uint8Array>, "Listening:");
    const match = out.match(/^Listening: http:\/\/127\.0\.0\.1:(\d+)$/m);
    expect(match).not.toBeNull();
    const actual = Number((match as RegExpMatchArray)[1]);
    expect(actual).not.toBe(taken);
    expect((await fetch(`http://127.0.0.1:${actual}/api/health`)).status).toBe(200);
    child.kill("SIGTERM");
    await child.exited;
    const stderr = await new Response(child.stderr as ReadableStream).text();
    expect(stderr).toContain(`Port ${taken} is in use; using ${actual}.`);
  } finally {
    await occupier.stop(true);
  }
});

test("--port free: the exact port is used and no fallback message is printed", async () => {
  const port = await freePort();
  const child = spawnCli([repoDir, "--port", String(port)]);
  const out = await readUntil(child.stdout as ReadableStream<Uint8Array>, "Listening:");
  expect(out).toContain(`Listening: http://127.0.0.1:${port}\n`);
  child.kill("SIGTERM");
  await child.exited;
  expect(await new Response(child.stderr as ReadableStream).text()).not.toContain("is in use");
});
