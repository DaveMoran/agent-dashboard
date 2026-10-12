import { test } from "bun:test";
import { parseCliArgs, usageText } from "../src/server/args.js";
import { UsageError } from "../src/server/errors.js";

test("valid path only", () => {
  const options = parseCliArgs(["/some/path"]);
  if (!options.repoPath) throw new Error("repoPath should be defined");
  if (options.port !== undefined) throw new Error("port should be undefined");
  if (options.help !== false) throw new Error("help should be false");
  if (options.version !== false) throw new Error("version should be false");
});

test("path plus --port", () => {
  const options = parseCliArgs(["/some/path", "--port", "4400"]);
  if (!options.repoPath) throw new Error("repoPath should be defined");
  if (options.port !== 4400) throw new Error("port should be 4400");
  if (options.help !== false) throw new Error("help should be false");
  if (options.version !== false) throw new Error("version should be false");
});

test("help flag", () => {
  const options = parseCliArgs(["--help"]);
  if (options.repoPath !== undefined) throw new Error("repoPath should be undefined");
  if (options.port !== undefined) throw new Error("port should be undefined");
  if (options.help !== true) throw new Error("help should be true");
  if (options.version !== false) throw new Error("version should be false");
});

test("version flag", () => {
  const options = parseCliArgs(["--version"]);
  if (options.repoPath !== undefined) throw new Error("repoPath should be undefined");
  if (options.port !== undefined) throw new Error("port should be undefined");
  if (options.help !== false) throw new Error("help should be false");
  if (options.version !== true) throw new Error("version should be true");
});

test("missing path", () => {
  expect(() => parseCliArgs([])).toThrow(UsageError);
});

test("invalid port - non-numeric", () => {
  expect(() => parseCliArgs(["/some/path", "--port", "abc"])).toThrow(UsageError);
});

test("invalid port - zero", () => {
  expect(() => parseCliArgs(["/some/path", "--port", "0"])).toThrow(UsageError);
});

test("invalid port - too large", () => {
  expect(() => parseCliArgs(["/some/path", "--port", "70000"])).toThrow(UsageError);
});

test("invalid port - decimal", () => {
  expect(() => parseCliArgs(["/some/path", "--port", "12.5"])).toThrow(UsageError);
});

test("unknown flag", () => {
  expect(() => parseCliArgs(["/some/path", "--unknown"])).toThrow(UsageError);
});

test("two positionals", () => {
  expect(() => parseCliArgs(["/some/path", "/another/path"])).toThrow(UsageError);
});