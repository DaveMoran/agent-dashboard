// Claude Code hook: appends one metadata-only line per event to
// <state root>/hooks/events.jsonl. Standalone on purpose (node builtins only),
// silent, and always exits 0 so it can never disturb a session.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Non-empty strings only; anything else counts as absent.
function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const session = str(input?.session_id);
  const event = str(input?.hook_event_name);
  if (typeof input === "object" && input !== null && session && event) {
    const cwd = str(input.cwd);
    const type = str(input.notification_type) ?? str(input.tool_name) ?? str(input.reason);
    const agent = str(input.agent_id);
    // Only these keys are ever written; absent optional keys are left out.
    const line = {
      ts: new Date().toISOString(),
      session,
      ...(cwd && { cwd }),
      event,
      ...(type && { type }),
      ...(agent && { agent }),
    };
    const root = process.env.AGENT_VISUALIZER_STATE_DIR || path.join(os.homedir(), ".agent-visualizer");
    const dir = path.join(root, "hooks");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(path.join(dir, "events.jsonl"), `${JSON.stringify(line)}\n`);
  }
} catch {
  // Never fail the session: swallow every error.
}
process.exit(0);
