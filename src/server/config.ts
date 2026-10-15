import { promises as fs } from "node:fs";
import * as path from "node:path";
import { CONFIG_FILE_NAME } from "./constants.js";
import { AppError } from "./errors.js";

export type Config = {
  port: number | undefined;
  adapter: string | undefined;
  mainAgentModel: string | undefined;
  transcriptsDir: string | undefined;
  source: string | undefined;
};

export class ConfigParseError extends AppError {}
export class ConfigValueError extends AppError {}

async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigValueError(`Invalid config in ${file}: cannot read file (${reason})`);
  }
}

export async function loadConfig(repoPath: string, cwd: string = process.cwd()): Promise<Config> {
  for (const dir of [repoPath, cwd]) {
    const file = path.resolve(dir, CONFIG_FILE_NAME);
    const text = await readIfPresent(file);
    if (text === undefined) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new ConfigParseError(
        `Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ConfigValueError(`Invalid config in ${file}: top level must be a JSON object`);
    }

    const { port, adapter, mainAgentModel, transcriptsDir } = parsed as {
      port?: unknown;
      adapter?: unknown;
      mainAgentModel?: unknown;
      transcriptsDir?: unknown;
    };
    if (port !== undefined) {
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ConfigValueError(
          `Invalid config in ${file}: "port" must be an integer between 1 and 65535, got ${JSON.stringify(port)}`,
        );
      }
    }
    if (adapter !== undefined) {
      if (typeof adapter !== "string" || adapter === "") {
        throw new ConfigValueError(
          `Invalid config in ${file}: "adapter" must be a non-empty string, got ${JSON.stringify(adapter)}`,
        );
      }
    }
    for (const [name, value] of [
      ["mainAgentModel", mainAgentModel],
      ["transcriptsDir", transcriptsDir],
    ] as const) {
      if (value !== undefined && (typeof value !== "string" || value === "")) {
        throw new ConfigValueError(
          `Invalid config in ${file}: "${name}" must be a non-empty string, got ${JSON.stringify(value)}`,
        );
      }
    }
    return {
      port: port as number | undefined,
      adapter: adapter as string | undefined,
      mainAgentModel: mainAgentModel as string | undefined,
      transcriptsDir: transcriptsDir as string | undefined,
      source: file,
    };
  }
  return {
    port: undefined,
    adapter: undefined,
    mainAgentModel: undefined,
    transcriptsDir: undefined,
    source: undefined,
  };
}
