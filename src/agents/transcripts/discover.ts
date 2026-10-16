import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Absolute paths of `<root>/<dir>/<name>.jsonl`, exactly two levels deep, sorted. */
export async function listSessionFiles(root: string): Promise<string[]> {
  if (!(await isDir(root))) return [];
  const out: string[] = [];
  for (const dir of await names(root)) {
    const dirPath = path.join(root, dir);
    if (!(await isDir(dirPath))) continue;
    for (const name of await names(dirPath)) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(dirPath, name);
      if (await isFile(file)) out.push(file);
    }
  }
  return out.sort();
}

/** Subagent transcripts of a session: `<stem>/subagents/agent-<id>.jsonl`, sorted by id. */
export async function listSubagentFiles(sessionFile: string): Promise<{ agentId: string; path: string }[]> {
  const dir = path.join(sessionFile.replace(/\.jsonl$/, ""), "subagents");
  const out: { agentId: string; path: string }[] = [];
  for (const name of await names(dir)) {
    const m = /^agent-(.+)\.jsonl$/.exec(name);
    if (!m) continue;
    const file = path.join(dir, name);
    if (await isFile(file)) out.push({ agentId: m[1]!, path: file });
  }
  return out.sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
}

export function transcriptsRoot(
  configDir: string | undefined,
  configValue: string | undefined,
  env: Record<string, string | undefined>,
): string {
  const fromEnv = env.AGENT_VISUALIZER_TRANSCRIPTS_DIR;
  if (fromEnv) return fromEnv;
  if (configValue) {
    if (configValue === "~") return os.homedir();
    if (configValue.startsWith("~/")) return path.join(os.homedir(), configValue.slice(2));
    if (path.isAbsolute(configValue)) return configValue;
    return path.resolve(configDir ?? process.cwd(), configValue);
  }
  return path.join(os.homedir(), ".claude", "projects");
}
