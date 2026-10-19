import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { HookStatus } from "../agents/attention/source.js";
import type { AgentSource } from "../agents/source.js";
import type { HealthResponse } from "../contract/health.js";
import type { BrainView, MagiResponse } from "../contract/magi.js";
import { emptySlotState } from "../magi/slots.js";
import type { RepoTarget } from "./repo.js";
import { buildSessionsResponse } from "./sessions.js";

export type HandlerOptions = {
  repo: RepoTarget;
  version: string;
  webRoot: string;
  devUi?: string;
  agentSource?: AgentSource;
  hookStatus?: () => HookStatus;
  magi?: { brains(): BrainView[] };
};

const UI_NOT_BUILT = "UI not built. Run `bun run build`.";

function isInside(root: string, file: string): boolean {
  return file === root || file.startsWith(root + path.sep);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function serveStatic(req: Request, url: URL, webRoot: string): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const root = path.resolve(webRoot);
  const indexFile = path.join(root, "index.html");
  if (!(await fileExists(indexFile))) {
    return new Response(UI_NOT_BUILT, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (pathname.includes("\0")) {
    return new Response("Bad Request", { status: 400 });
  }

  const requested = path.resolve(root, `.${pathname}`);
  if (!isInside(root, requested)) {
    return new Response("Not Found", { status: 404 });
  }

  if (await fileExists(requested)) {
    // Resolve symlinks so a link inside webRoot cannot point outside it.
    const real = await fs.realpath(requested);
    if (!isInside(await fs.realpath(root), real)) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(Bun.file(real));
  }

  if (path.extname(pathname) === "") {
    return new Response(Bun.file(indexFile));
  }
  return new Response("Not Found", { status: 404 });
}

// fetch() decodes the upstream body, so these headers would no longer describe it.
const STRIPPED_RESPONSE_HEADERS = ["content-encoding", "content-length", "transfer-encoding"];

async function proxyToDevUi(req: Request, url: URL, devUi: string): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.delete("host");
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const upstream = await fetch(new URL(url.pathname + url.search, devUi), {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of STRIPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return new Response(`Vite dev server unreachable at ${devUi}`, {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

export function createHandler(opts: HandlerOptions): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/api/health") {
      if (req.method !== "GET") {
        return new Response(null, { status: 405, headers: { Allow: "GET" } });
      }
      const body: HealthResponse = {
        status: "ok",
        repoPath: opts.repo.path,
        repoName: opts.repo.name,
        version: opts.version,
        attentionHook: opts.hookStatus?.() ?? { seen: false, lastEventAt: null },
      };
      return Response.json(body);
    }

    if (url.pathname === "/api/sessions") {
      if (req.method !== "GET") {
        return new Response(null, { status: 405, headers: { Allow: "GET" } });
      }
      return Response.json(buildSessionsResponse(opts.agentSource?.sessions() ?? []));
    }

    if (url.pathname === "/api/magi") {
      if (req.method !== "GET") {
        return new Response(null, { status: 405, headers: { Allow: "GET" } });
      }
      const brains = opts.magi?.brains() ?? emptySlotState().brains;
      return Response.json({ brains } satisfies MagiResponse);
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    if (opts.devUi) return proxyToDevUi(req, url, opts.devUi);
    return serveStatic(req, url, opts.webRoot);
  };
}
