import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { AppError } from "./errors.js";

export class RepoNotFoundError extends AppError {
  constructor(message: string) {
    super(message);
  }
}

export class RepoNotDirectoryError extends AppError {
  constructor(message: string) {
    super(message);
  }
}

export class RepoNotReadableError extends AppError {
  constructor(message: string) {
    super(message);
  }
}

export type RepoTarget = {
  path: string;
  name: string;
};

export async function resolveRepoPath(input: string): Promise<RepoTarget> {
  // Expand leading ~ to homedir
  let normalizedPath = input;
  if (input.startsWith("~")) {
    normalizedPath = path.join(os.homedir(), input.slice(1));
  }

  // Resolve relative paths to cwd
  if (!path.isAbsolute(normalizedPath)) {
    normalizedPath = path.resolve(process.cwd(), normalizedPath);
  }

  // Get real path (resolves symlinks)
  const realPath = await fs.realpath(normalizedPath);

  // Check that it's a directory
  let stat;
  try {
    stat = await fs.stat(realPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === "ENOENT") {
      throw new RepoNotFoundError(`Directory not found: ${realPath}`);
    }
    throw error;
  }

  if (!stat.isDirectory()) {
    throw new RepoNotDirectoryError(`Path is not a directory: ${realPath}`);
  }

  // Check that it's readable
  try {
    await fs.access(realPath, fs.constants.R_OK);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === "EACCES") {
      throw new RepoNotReadableError(`Directory is not readable: ${realPath}`);
    }
    throw error;
  }

  return {
    path: realPath,
    name: path.basename(realPath)
  };
}