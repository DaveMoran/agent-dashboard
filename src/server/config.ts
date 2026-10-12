import { promises as fs } from "node:fs";
import * as path from "node:path";
import { CONFIG_FILE_NAME } from "./constants.js";
import { AppError } from "./errors.js";

export type Config = {
  port: number | undefined;
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

    const { port } = parsed as { port?: unknown };
    if (port !== undefined) {
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ConfigValueError(
          `Invalid config in ${file}: "port" must be an integer between 1 and 65535, got ${JSON.stringify(port)}`,
        );
      }
    }
    return { port: port as number | undefined, source: file };
  }
  return { port: undefined, source: undefined };
}
