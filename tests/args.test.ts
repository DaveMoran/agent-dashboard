import { expect, test } from "bun:test";
import { parseCliArgs, usageText } from "../src/server/args.js";
import { UsageError } from "../src/server/errors.js";

function usageError(argv: string[]): UsageError {
  try {
    parseCliArgs(argv);
  } catch (error) {
    expect(error).toBeInstanceOf(UsageError);
    return error as UsageError;
  }
  throw new Error(`parseCliArgs(${JSON.stringify(argv)}) did not throw`);
}

test("valid path only", () => {
  expect(parseCliArgs(["/some/path"])).toEqual({
    repoPath: "/some/path",
    port: undefined,
    help: false,
    version: false,
  });
});

test("path plus --port 4400", () => {
  expect(parseCliArgs(["/some/path", "--port", "4400"])).toEqual({
    repoPath: "/some/path",
    port: 4400,
    help: false,
    version: false,
  });
});

test("--port accepts the boundaries 1 and 65535", () => {
  expect(parseCliArgs(["/p", "--port", "1"]).port).toBe(1);
  expect(parseCliArgs(["/p", "--port", "65535"]).port).toBe(65535);
});

test("--help needs no path", () => {
  expect(parseCliArgs(["--help"])).toEqual({
    repoPath: undefined,
    port: undefined,
    help: true,
    version: false,
  });
});

test("--version needs no path", () => {
  expect(parseCliArgs(["--version"])).toEqual({
    repoPath: undefined,
    port: undefined,
    help: false,
    version: true,
  });
});

test("missing path is a UsageError with exit code 2", () => {
  const error = usageError([]);
  expect(error.exitCode).toBe(2);
  expect(error.message).toContain("Missing repository path");
});

test.each([
  ["abc", "abc"],
  ["0", "0"],
  ["70000", "70000"],
  ["12.5", "12.5"],
  ["-1", "-1"],
  ["", "Invalid port value"],
])("--port %p is rejected and the message names the value", (value, expected) => {
  const error = usageError(["/some/path", "--port", value]);
  expect(error.exitCode).toBe(2);
  expect(error.message).toContain(expected);
  expect(error.message).toContain("Invalid port value");
});

test("--port without a value is a UsageError", () => {
  expect(usageError(["/some/path", "--port"]).exitCode).toBe(2);
});

test("unknown flag is a UsageError naming the flag", () => {
  const error = usageError(["/some/path", "--unknown"]);
  expect(error.exitCode).toBe(2);
  expect(error.message).toContain("--unknown");
});

test("two positionals is a UsageError", () => {
  const error = usageError(["/some/path", "/another/path"]);
  expect(error.exitCode).toBe(2);
  expect(error.message).toContain("Too many positional arguments");
});

test("usage text documents the contract's synopsis and exit codes", () => {
  expect(usageText).toContain("Usage: agent-visualizer <repo-path> [--port <n>]");
  expect(usageText).toContain("--help | --version");
  expect(usageText).toContain("Exit codes:");
});
