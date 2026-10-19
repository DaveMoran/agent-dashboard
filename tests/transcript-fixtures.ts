import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { copyFixture } from "./helpers";

function jsonlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonlFiles(p));
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

/** Copy fixtures/transcripts/<scenario>/ to a temp dir and fill {{NAME}} placeholders. */
export async function materializeTranscripts(
  scenario: string,
  vars: Record<string, string>,
): Promise<string> {
  const root = await copyFixture(path.join("transcripts", scenario));
  fillPlaceholders(root, vars);
  return root;
}

/** Replace {{NAME}} placeholders in every .jsonl under root; throws if a name has no value. */
export function fillPlaceholders(root: string, vars: Record<string, string>): void {
  for (const file of jsonlFiles(root)) {
    const text = readFileSync(file, "utf8");
    const filled = text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_m, name: string) => {
      if (!Object.hasOwn(vars, name)) {
        throw new Error(`No value for placeholder {{${name}}} in ${file}`);
      }
      return vars[name]!;
    });
    writeFileSync(file, filled);
  }
}

export function appendLine(file: string, line: string): void {
  appendFileSync(file, `${line}\n`);
}

export function appendRaw(file: string, text: string): void {
  appendFileSync(file, text);
}
