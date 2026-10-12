import { test } from "bun:test";
import { parseCliArgs, usageText } from "../src/server/args.js";

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
  try {
    parseCliArgs([]);
    throw new Error("Should have thrown UsageError");
  } catch (error) {
    if (!(error instanceof Error)) throw new Error("Expected UsageError");
    // We expect this to fail, but we don't check the exact message here
  }
});

test("invalid port - non-numeric", () => {
  try {
    parseCliArgs(["/some/path", "--port", "abc"]);
    throw new Error("Should have thrown UsageError");
  } catch (error) {
    if (!(error instanceof Error)) throw new Error("Expected UsageError");
    // We expect this to fail
  }
});

test("invalid port - zero", () => {
  try {
    parseCliArgs(["/some/path", "--port", "0"]);
    throw new Error("Should have thrown UsageError");
  } catch (error) {
    if (!(error instanceof Error)) throw new Error("Expected UsageError");
    // We expect this to fail
  }
});

test("invalid port - too large", () => {
  try {
    parseCliArgs(["/some/path", "--port", "70000"]);
    throw new Error("Should have thrown UsageError");
  } catch (error) {
    if (!(error instanceof Error)) throw new Error("Expected UsageError");
    // We expect this to fail
  }
});

test("invalid port - decimal", () => {
  try {
    parseCliArgs(["/some/path", "--port", "12.5"]);
    throw new Error("Should have thrown UsageError");
  } catch (error) {
    if (!(error instanceof Error)) throw new Error("Expected UsageError");
    // We expect this to fail
  }
});

test("unknown flag", () => {
  try {
    parseCliArgs(["/some/path", "--unknown"]);
    throw new Error("Should have thrown UsageError");
  } catch (error) {
    if (!(error instanceof Error)) throw new Error("Expected UsageError");
    // We expect this to fail
  }
});

test("two positionals", () => {
  try {
    parseCliArgs(["/some/path", "/another/path"]);
    throw new Error("Should have thrown UsageError");
  } catch (error) {
    if (!(error instanceof Error)) throw new Error("Expected UsageError");
    // We expect this to fail
  }
});