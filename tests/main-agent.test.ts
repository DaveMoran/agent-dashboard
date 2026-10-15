import { describe, expect, test } from "bun:test";
import { compileMainAgentPattern, DEFAULT_MAIN_AGENT_PATTERN } from "../src/agents/main-agent";

const ids = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"];
const matching = (re: RegExp) => ids.filter((id) => re.test(id));

describe("compileMainAgentPattern", () => {
  test("default matches opus and fable only", () => {
    const { regex, warning } = compileMainAgentPattern(undefined);
    expect(warning).toBeUndefined();
    expect(regex.source).toBe(DEFAULT_MAIN_AGENT_PATTERN);
    expect(matching(regex)).toEqual(["claude-opus-5-5", "claude-fable-5-1"]);
  });

  test("custom pattern is used", () => {
    const { regex, warning } = compileMainAgentPattern("^claude-sonnet");
    expect(warning).toBeUndefined();
    expect(matching(regex)).toEqual(["claude-sonnet-5-5"]);
  });

  test("invalid pattern falls back to default with a warning", () => {
    const { regex, warning } = compileMainAgentPattern("(");
    expect(regex.source).toBe(DEFAULT_MAIN_AGENT_PATTERN);
    expect(warning).toContain("mainAgentModel");
    expect(warning).toContain(`using default ${DEFAULT_MAIN_AGENT_PATTERN}`);
    expect(matching(regex)).toEqual(["claude-opus-5-5", "claude-fable-5-1"]);
  });
});
