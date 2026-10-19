const QUESTION_TOOLS = "AskUserQuestion|ExitPlanMode";

export interface HookRegistration {
  event: string;
  matcher?: string;
  async: boolean;
}

export const HOOK_REGISTRATIONS: readonly HookRegistration[] = [
  { event: "PermissionRequest", async: false },
  { event: "PreToolUse", matcher: QUESTION_TOOLS, async: false },
  { event: "Elicitation", async: false },
  { event: "PostToolUse", matcher: QUESTION_TOOLS, async: true },
  { event: "PostToolUseFailure", matcher: QUESTION_TOOLS, async: true },
  { event: "ElicitationResult", async: true },
  { event: "UserPromptSubmit", async: true },
  { event: "Stop", async: true },
  { event: "StopFailure", async: true },
  { event: "SubagentStop", async: true },
  { event: "SessionEnd", async: false },
];

export interface HookCommand {
  type: string;
  command: string;
  async?: boolean;
}

export interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

export interface HookSettings {
  hooks: Record<string, HookEntry[]>;
}

function quote(p: string): string {
  return p.includes(" ") ? `"${p}"` : p;
}

export function buildHookSettings(bunPath: string, hookScriptPath: string): HookSettings {
  const command = `${quote(bunPath)} ${quote(hookScriptPath)}`;
  const hooks: Record<string, HookEntry[]> = {};
  for (const r of HOOK_REGISTRATIONS) {
    const cmd: HookCommand = r.async
      ? { type: "command", command, async: true }
      : { type: "command", command };
    const entry: HookEntry =
      r.matcher === undefined ? { hooks: [cmd] } : { matcher: r.matcher, hooks: [cmd] };
    hooks[r.event] = [entry];
  }
  return { hooks };
}
