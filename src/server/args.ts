import { parseArgs } from "node:util";
import { UsageError } from "./errors.js";

export type CliOptions = {
  repoPath: string | undefined;
  port: number | undefined;
  help: boolean;
  version: boolean;
};

export const usageText = `Usage: agent-visualizer <repo-path> [--port <n>]
       agent-visualizer --help | --version

Arguments:
  <repo-path>    Directory to observe. Relative, ~-prefixed and symlinked paths accepted.
  --port <n>     Preferred port, integer 1-65535. Falls back to a free port if taken.
  --help         Print usage to stdout, exit 0.
  --version      Print the tool version to stdout, exit 0.

Exit codes:
  0  Clean shutdown after SIGINT/SIGTERM, or --help/--version
  1  Runtime/environment failure: repo path not found, not a directory, unreadable; config file unparseable or invalid; state dir not writable; instance already running for this repo
  2  Usage error: missing <repo-path>, unknown flag, invalid --port

Every non-zero exit prints a single message to stderr that names the specific problem and, for "already running", the existing address (http://127.0.0.1:<port>).`;

export function parseCliArgs(argv: string[]): CliOptions {
  // parseArgs refuses option values that start with "-" and its message does not
  // name the value, so catch negative numbers here.
  const portAt = argv.indexOf("--port");
  const next = portAt >= 0 ? argv[portAt + 1] : undefined;
  if (next !== undefined && /^-\d/.test(next)) {
    throw new UsageError(`Invalid port value: ${next}. Port must be between 1 and 65535.`);
  }

  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        port: {
          type: "string",
        },
        help: {
          type: "boolean",
        },
        version: {
          type: "boolean",
        },
      },
      allowPositionals: true,
      strict: true,
    });

    const { port } = values;

    let repoPath: string | undefined;
    if (positionals.length > 0) {
      repoPath = positionals[0];
    }

    // Validate port if provided
    let validatedPort: number | undefined;
    if (port !== undefined) {
      // Check if port matches the required pattern /^\d+$/
      if (!/^\d+$/.test(port)) {
        throw new UsageError(`Invalid port value: ${port}. Port must be a positive integer.`);
      }

      const portNum = Number(port);
      if (!Number.isInteger(portNum)) {
        throw new UsageError(`Invalid port value: ${port}. Port must be an integer.`);
      }
      if (portNum <= 0 || portNum > 65535) {
        throw new UsageError(`Invalid port value: ${port}. Port must be between 1 and 65535.`);
      }
      validatedPort = portNum;
    }

    // Validate positional arguments
    if (repoPath === undefined && !values.help && !values.version) {
      throw new UsageError("Missing repository path. Use --help for usage information.");
    }

    if (positionals.length > 1) {
      throw new UsageError(`Too many positional arguments. Expected 1, got ${positionals.length}.`);
    }

    // Handle boolean flags properly - they're undefined when not provided
    const help = values.help === true;
    const version = values.version === true;

    return {
      repoPath,
      port: validatedPort,
      help,
      version,
    };
  } catch (error) {
    if (error instanceof UsageError) {
      throw error; // Re-throw UsageError as-is
    }
    // Wrap other errors in UsageError
    throw new UsageError(`Invalid argument: ${error instanceof Error ? error.message : String(error)}`);
  }
}
