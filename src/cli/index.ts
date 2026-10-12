#!/usr/bin/env bun
import { parseCliArgs, usageText } from "../server/args.js";
import { DEFAULT_PORT } from "../server/constants.js";
import { AppError, UsageError } from "../server/errors.js";
import { resolveRepoPath } from "../server/repo.js";
import { startServer } from "../server/start.js";
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
  const server = await startServer({ repo, port: options.port ?? DEFAULT_PORT });

  if (server.fellBack) {
    console.error(`Port ${server.requestedPort} is in use; using ${server.port}.`);
  }
  console.log(`Agent Visualizer ${version}`);
  console.log(`Observing: ${repo.path}`);
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
