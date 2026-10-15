export const DEFAULT_MAIN_AGENT_PATTERN = "^claude-(opus|fable)";

export function compileMainAgentPattern(source: string | undefined): {
  regex: RegExp;
  warning: string | undefined;
} {
  if (source === undefined) {
    return { regex: new RegExp(DEFAULT_MAIN_AGENT_PATTERN), warning: undefined };
  }
  try {
    return { regex: new RegExp(source), warning: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      regex: new RegExp(DEFAULT_MAIN_AGENT_PATTERN),
      warning: `Invalid "mainAgentModel" in config: ${message}; using default ${DEFAULT_MAIN_AGENT_PATTERN}`,
    };
  }
}
