import * as path from "node:path";
import { HOST } from "./constants.js";
import type { RepoTarget } from "./repo.js";
import { createHandler } from "./routes.js";
import { version } from "./version.js";

export type StartOptions = {
  repo: RepoTarget;
  port: number;
  webRoot?: string;
  devUi?: string;
};

export type RunningServer = {
  port: number;
  url: string;
  stop: () => Promise<void>;
};

const DEFAULT_WEB_ROOT = path.resolve(import.meta.dir, "../../dist/web");

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const server = Bun.serve({
    hostname: HOST,
    port: opts.port,
    fetch: createHandler({
      repo: opts.repo,
      version,
      webRoot: opts.webRoot ?? DEFAULT_WEB_ROOT,
      devUi: opts.devUi,
    }),
  });
  const port = server.port as number;
  return {
    port,
    url: `http://${HOST}:${port}`,
    stop: async () => {
      await server.stop(true);
    },
  };
}
