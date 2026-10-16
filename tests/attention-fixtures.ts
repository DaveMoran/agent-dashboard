import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { copyFixture } from "./helpers";
import { fillPlaceholders } from "./transcript-fixtures";

function jsonlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonlFiles(p));
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

function scenarioFiles(dir: string): string[] {
  return [...jsonlFiles(path.join(dir, "projects")), path.join(dir, "events.jsonl")];
}

/** Copy fixtures/attention/<scenario>/ to a temp dir and fill {{NAME}} placeholders. */
export async function materializeAttention(
  scenario: string,
  vars: Record<string, string>,
): Promise<{ dir: string; transcriptsRoot: string; eventsFile: string }> {
  const dir = await copyFixture(path.join("attention", scenario));
  fillPlaceholders(dir, vars);
  return { dir, transcriptsRoot: path.join(dir, "projects"), eventsFile: path.join(dir, "events.jsonl") };
}

function lineTs(text: string): string {
  try {
    const o = JSON.parse(text) as { timestamp?: unknown; ts?: unknown };
    const v = o.timestamp ?? o.ts;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

/** Every non-empty line of the scenario's transcripts and events file, sorted by timestamp, then file, then line. */
export function scenarioLines(dir: string): { file: string; text: string; ts: string }[] {
  const out: { file: string; text: string; ts: string }[] = [];
  for (const file of scenarioFiles(dir)) {
    for (const text of readFileSync(file, "utf8").split("\n")) {
      if (text.trim() === "") continue;
      out.push({ file, text, ts: lineTs(text) });
    }
  }
  return out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/** Truncate every transcript and events file of the scenario to 0 bytes. */
export function emptyCopy(dir: string): void {
  for (const file of scenarioFiles(dir)) writeFileSync(file, "");
}
