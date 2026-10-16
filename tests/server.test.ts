import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startServer } from "../src/server/start.js";
import { version } from "../src/server/version.js";

let tmp: string;
let repoDir: string;
let webRoot: string;
let stops: Array<() => Promise<void>>;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "server-test-")));
  repoDir = path.join(tmp, "demo-repo");
  webRoot = path.join(tmp, "web");
  fs.mkdirSync(repoDir);
  fs.mkdirSync(webRoot);
  fs.writeFileSync(path.join(webRoot, "index.html"), "<html>INDEX</html>");
  fs.writeFileSync(path.join(webRoot, "app.js"), "console.log('app')");
  fs.writeFileSync(path.join(tmp, "secret.txt"), "TOP SECRET");
  stops = [];
});

afterEach(async () => {
  for (const stop of stops) await stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function start(opts: { webRoot?: string; devUi?: string } = {}) {
  const server = await startServer({
    repo: { path: repoDir, name: "demo-repo" },
    port: 0,
    webRoot: opts.webRoot ?? webRoot,
    devUi: opts.devUi,
  });
  stops.push(server.stop);
  return server;
}

test("binds to 127.0.0.1 on the actual port", async () => {
  const server = await start();
  expect(server.port).toBeGreaterThan(0);
  expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
});

test("GET /api/health returns the exact JSON body", async () => {
  const server = await start();
  const res = await fetch(`${server.url}/api/health`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toEqual({
    status: "ok",
    repoPath: repoDir,
    repoName: "demo-repo",
    version,
  });
});

test("POST /api/health returns 405", async () => {
  const server = await start();
  const res = await fetch(`${server.url}/api/health`, { method: "POST" });
  expect(res.status).toBe(405);
});

test("unknown /api/ path returns 404 { error: not_found }", async () => {
  const server = await start();
  const res = await fetch(`${server.url}/api/nope`);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
});

test("/ serves index.html", async () => {
  const server = await start();
  const res = await fetch(`${server.url}/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("<html>INDEX</html>");
});

test("existing file is served with its own content", async () => {
  const server = await start();
  const res = await fetch(`${server.url}/app.js`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("console.log('app')");
});

test("unknown extension-less route falls back to index.html", async () => {
  const server = await start();
  const res = await fetch(`${server.url}/some/route`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("<html>INDEX</html>");
});

test("missing file with an extension is 404, not the index", async () => {
  const server = await start();
  const res = await fetch(`${server.url}/missing.js`);
  expect(res.status).toBe(404);
});

test("path traversal cannot escape webRoot", async () => {
  const server = await start();
  for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2fsecret.txt"]) {
    const res = await fetch(`${server.url}${p}`);
    expect(await res.text()).not.toContain("TOP SECRET");
    expect(res.status).not.toBe(200);
  }
});

test("a symlink inside webRoot pointing outside is not followed", async () => {
  fs.symlinkSync(path.join(tmp, "secret.txt"), path.join(webRoot, "leak.txt"));
  const server = await start();
  const res = await fetch(`${server.url}/leak.txt`);
  expect(res.status).toBe(404);
  expect(await res.text()).not.toContain("TOP SECRET");
});

test("empty webRoot returns 503 with the build hint", async () => {
  const empty = path.join(tmp, "empty");
  fs.mkdirSync(empty);
  const server = await start({ webRoot: empty });
  const res = await fetch(`${server.url}/`);
  expect(res.status).toBe(503);
  expect(await res.text()).toBe("UI not built. Run `bun run build`.");
  // the API keeps working without a UI build
  expect((await fetch(`${server.url}/api/health`)).status).toBe(200);
});

test("startServer reports a fallback when the requested port is taken", async () => {
  const occupier = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  try {
    const server = await startServer({
      repo: { path: repoDir, name: "demo-repo" },
      port: occupier.port as number,
      webRoot,
    });
    stops.push(server.stop);
    expect(server.fellBack).toBe(true);
    expect(server.requestedPort).toBe(occupier.port as number);
    expect(server.port).not.toBe(occupier.port);
    expect((await fetch(`${server.url}/api/health`)).status).toBe(200);
  } finally {
    await occupier.stop(true);
  }
});

test("devUi: non-API requests are proxied to the upstream, /api/health stays local", async () => {
  const seen: string[] = [];
  const upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req) => {
      const url = new URL(req.url);
      seen.push(req.method + " " + url.pathname + url.search);
      if (url.pathname === "/")
        return new Response("<html>VITE</html>", { headers: { "content-type": "text/html" } });
      if (url.pathname === "/foo.js")
        return new Response("export const foo = 1", { headers: { "content-type": "text/javascript" } });
      if (url.pathname === "/echo") return new Response(`echo:${req.method}`, { status: 201 });
      if (url.pathname === "/api/health") return new Response("UPSTREAM HEALTH");
      return new Response("nope", { status: 404 });
    },
  });
  try {
    // webRoot is empty: if the proxy were skipped, "/" would be a 503.
    const empty = path.join(tmp, "empty");
    fs.mkdirSync(empty);
    const server = await start({ webRoot: empty, devUi: `http://127.0.0.1:${upstream.port}` });

    const index = await fetch(`${server.url}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toBe("<html>VITE</html>");

    const js = await fetch(`${server.url}/foo.js?v=1`);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(await js.text()).toBe("export const foo = 1");

    const post = await fetch(`${server.url}/echo`, { method: "POST", body: "x" });
    expect(post.status).toBe(201);
    expect(await post.text()).toBe("echo:POST");

    expect((await fetch(`${server.url}/missing`)).status).toBe(404);

    const health = await fetch(`${server.url}/api/health`);
    expect(((await health.json()) as { repoName: string }).repoName).toBe("demo-repo");
    expect((await fetch(`${server.url}/api/nope`)).status).toBe(404);

    expect(seen).toContain("GET /foo.js?v=1");
    expect(seen.some((s) => s.includes("/api/"))).toBe(false);
  } finally {
    await upstream.stop(true);
  }
});

test("devUi unreachable returns 502 with the hint", async () => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const closed = `http://127.0.0.1:${probe.port}`;
  await probe.stop(true);
  const server = await start({ devUi: closed });
  const res = await fetch(`${server.url}/`);
  expect(res.status).toBe(502);
  expect(await res.text()).toBe(`Vite dev server unreachable at ${closed}`);
  expect((await fetch(`${server.url}/api/health`)).status).toBe(200);
});
