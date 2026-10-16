import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HOST } from "./constants.js";
import { AppError } from "./errors.js";

export type InstanceRecord = {
  port: number;
  pid: number;
  repoPath: string;
  startedAt: string;
  version: string;
};

export class StateDirError extends AppError {}

export class InstanceRunningError extends AppError {
  constructor(repoPath: string, port: number) {
    super(`Agent Visualizer is already running for ${repoPath} at http://${HOST}:${port}`);
  }
}

export function stateRoot(): string {
  return process.env.AGENT_VISUALIZER_STATE_DIR || path.join(os.homedir(), ".agent-visualizer");
}

export function repoKey(repoPath: string): string {
  const slug = path
    .basename(repoPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const hash = createHash("sha1").update(repoPath).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
}

export function instancePath(repoPath: string): string {
  return path.join(stateRoot(), "instances", repoKey(repoPath), "server.json");
}

function isInstanceRecord(value: unknown): value is InstanceRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    Number.isInteger(r.port) &&
    Number.isInteger(r.pid) &&
    typeof r.repoPath === "string" &&
    typeof r.startedAt === "string" &&
    typeof r.version === "string"
  );
}

export async function writeInstance(record: InstanceRecord): Promise<void> {
  const file = instancePath(record.repoPath);
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.server.json.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(tmp, JSON.stringify(record, null, 2) + "\n");
    await fs.promises.rename(tmp, file);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    const reason = error instanceof Error ? error.message : String(error);
    throw new StateDirError(`Cannot write state directory ${dir}: ${reason}`);
  }
}

export async function readInstance(repoPath: string): Promise<InstanceRecord | null> {
  let text: string;
  try {
    text = await fs.promises.readFile(instancePath(repoPath), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isInstanceRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Deletes the record only if the on-disk pid equals `pid`. Synchronous so it can run
 * from a process "exit" handler. Returns whether a file was removed.
 */
export function removeInstance(repoPath: string, pid: number): boolean {
  const file = instancePath(repoPath);
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isInstanceRecord(parsed) || parsed.pid !== pid) return false;
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

export async function isLive(record: InstanceRecord): Promise<boolean> {
  try {
    process.kill(record.pid, 0);
  } catch (error) {
    // EPERM: the process exists but belongs to someone else; the health check decides.
    if ((error as { code?: string }).code !== "EPERM") return false;
  }
  try {
    const res = await fetch(`http://${HOST}:${record.port}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    const body = (await res.json()) as { repoPath?: unknown };
    return body.repoPath === record.repoPath;
  } catch {
    return false;
  }
}
