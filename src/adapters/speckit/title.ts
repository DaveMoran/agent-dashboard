import { isFenceLine } from "./tasks";

const HEADING_RE = /^# +(.*)$/;
const PREFIX_RE = /^feature specification:/i;

export function parseTitle(specMd: string): string | null {
  let inFence = false;
  for (const raw of specMd.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING_RE.exec(line);
    if (!m) continue;
    const title = m[1]!.replace(PREFIX_RE, "").trim();
    return title === "" ? null : title;
  }
  return null;
}
