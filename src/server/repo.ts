import { constants, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AppError } from "./errors.js";

export class RepoNotFoundError extends AppError {}
export class RepoNotDirectoryError extends AppError {}
export class RepoNotReadableError extends AppError {}

export type RepoTarget = {
  path: string;
  name: string;
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export async function resolveRepoPath(input: string): Promise<RepoTarget> {
  let candidate = input;
  if (candidate === "~" || candidate.startsWith("~/")) {
    candidate = path.join(os.homedir(), candidate.slice(1));
  }
  candidate = path.resolve(process.cwd(), candidate);

  let realPath: string;
  try {
    realPath = await fs.realpath(candidate);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
      throw new RepoNotFoundError(`Repository path not found: ${candidate}`);
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new RepoNotReadableError(`Repository path is not readable: ${candidate}`);
    }
    throw error;
  }

  let isDirectory: boolean;
  try {
    isDirectory = (await fs.stat(realPath)).isDirectory();
  } catch (error) {
    const code = errorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      throw new RepoNotReadableError(`Repository path is not readable: ${realPath}`);
    }
    throw error;
  }
  if (!isDirectory) {
    throw new RepoNotDirectoryError(`Repository path is not a directory: ${realPath}`);
  }

  try {
    await fs.access(realPath, constants.R_OK);
  } catch (error) {
    const code = errorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      throw new RepoNotReadableError(`Repository path is not readable: ${realPath}`);
    }
    throw error;
  }

  return { path: realPath, name: path.basename(realPath) };
}
