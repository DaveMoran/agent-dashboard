import * as path from "node:path";
import type { AgentSource } from "../agents/source.js";
import { HOST } from "./constants.js";
import { listenWithFallback } from "./port.js";
import type { RepoTarget } from "./repo.js";
import { createHandler } from "./routes.js";
import { version } from "./version.js";

export type StartOptions = {
  repo: RepoTarget;
  port: number;
  webRoot?: string;
  devUi?: string;
  agentSource?: AgentSource;
};

export type RunningServer = {
  port: number;
  requestedPort: number;
  fellBack: boolean;
  url: string;
  stop: () => Promise<void>;
};

const DEFAULT_WEB_ROOT = path.resolve(import.meta.dir, "../../dist/web");

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const fetch = createHandler({
    repo: opts.repo,
    version,
    webRoot: opts.webRoot ?? DEFAULT_WEB_ROOT,
    devUi: opts.devUi,
    agentSource: opts.agentSource,
  });
  const { server, fellBack } = listenWithFallback(opts.port, (port) =>
    Bun.serve({ hostname: HOST, port, fetch }),
  );
  const port = server.port as number;
  return {
    port,
    requestedPort: opts.port,
    fellBack,
    url: `http://${HOST}:${port}`,
    stop: async () => {
      await server.stop(true);
    },
  };
}
