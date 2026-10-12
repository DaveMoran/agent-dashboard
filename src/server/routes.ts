import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { RepoTarget } from "./repo.js";

export type HandlerOptions = {
  repo: RepoTarget;
  version: string;
  webRoot: string;
  devUi?: string;
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

  const requested = path.resolve(root, "." + pathname);
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

export function createHandler(opts: HandlerOptions): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/api/health") {
      if (req.method !== "GET") {
        return new Response(null, { status: 405, headers: { Allow: "GET" } });
      }
      return Response.json({
        status: "ok",
        repoPath: opts.repo.path,
        repoName: opts.repo.name,
        version: opts.version,
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    return serveStatic(req, url, opts.webRoot);
  };
}
