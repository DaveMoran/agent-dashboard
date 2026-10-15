#!/usr/bin/env bun
import * as path from "node:path";
import { compileMainAgentPattern } from "../agents/main-agent.js";
import { transcriptsRoot } from "../agents/transcripts/discover.js";
import { createTranscriptSource } from "../agents/transcripts/source.js";
import { parseCliArgs, usageText } from "../server/args.js";
import { adapters } from "../adapters/index.js";
import { assertKnownAdapter, createRegistry } from "../core/registry.js";
import { loadConfig } from "../server/config.js";
import { DEFAULT_PORT } from "../server/constants.js";
import { AppError, UsageError } from "../server/errors.js";
import { resolveRepoPath } from "../server/repo.js";
import { startServer } from "../server/start.js";
import {
  InstanceRunningError,
  isLive,
  readInstance,
  removeInstance,
  writeInstance,
} from "../server/state.js";
import { version } from "../server/version.js";

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usageText);
    return;
  }
  if (options.version) {
    console.log(version);
    return;
  }

  // parseCliArgs guarantees repoPath unless --help/--version, handled above.
  const repo = await resolveRepoPath(options.repoPath as string);

  const config = await loadConfig(repo.path);
  const port = options.port ?? config.port ?? DEFAULT_PORT;
  assertKnownAdapter(config.adapter, createRegistry(adapters));

  const existing = await readInstance(repo.path);
  if (existing && (await isLive(existing))) {
    throw new InstanceRunningError(existing.repoPath, existing.port);
  }

  const { regex, warning } = compileMainAgentPattern(config.mainAgentModel);
  if (warning) console.error(warning);
  const root = transcriptsRoot(
    config.source ? path.dirname(config.source) : undefined,
    config.transcriptsDir,
    process.env,
  );
  const source = createTranscriptSource({ root, mainAgentPattern: regex });
  await source.start();

  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({
      repo,
      port,
      devUi: process.env.AGENT_VISUALIZER_DEV_UI,
      agentSource: source,
    });
  } catch (error) {
    await source.stop();
    throw error;
  }
  try {
    await writeInstance({
      port: server.port,
      pid: process.pid,
      repoPath: repo.path,
      startedAt: new Date().toISOString(),
      version,
    });
  } catch (error) {
    await server.stop();
    await source.stop();
    throw error;
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.stop();
    await source.stop();
    removeInstance(repo.path, process.pid);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", () => {
    removeInstance(repo.path, process.pid);
  });

  if (server.fellBack) {
    console.error(`Port ${server.requestedPort} is in use; using ${server.port}.`);
  }
  console.log(`Agent Visualizer ${version}`);
  console.log(`Observing: ${repo.path}`);
  console.log(`Transcripts: ${root}`);
  console.log(`Listening: ${server.url}`);
}

main().catch((error: unknown) => {
  if (error instanceof AppError) {
    console.error(error.message);
    if (error instanceof UsageError) console.error(`\n${usageText}`);
    process.exit(error.exitCode);
  }
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
