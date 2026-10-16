import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigParseError, ConfigValueError, loadConfig } from "../src/server/config.js";

let repo: string;
let cwd: string;
let root: string;
const NAME = "agent-visualizer.config.json";

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "config-test-")));
  repo = path.join(root, "repo");
  cwd = path.join(root, "cwd");
  fs.mkdirSync(repo);
  fs.mkdirSync(cwd);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const put = (dir: string, content: string) => fs.writeFileSync(path.join(dir, NAME), content);

test("no file returns undefined port and source", async () => {
  expect(await loadConfig(repo, cwd)).toStrictEqual({
    port: undefined,
    adapter: undefined,
    mainAgentModel: undefined,
    transcriptsDir: undefined,
    source: undefined,
  });
});

test("file in repo only", async () => {
  put(repo, '{"port": 4400}');
  expect(await loadConfig(repo, cwd)).toStrictEqual({
    port: 4400,
    adapter: undefined,
    mainAgentModel: undefined,
    transcriptsDir: undefined,
    source: path.join(repo, NAME),
  });
});

test("file in cwd only", async () => {
  put(cwd, '{"port": 4401}');
  expect(await loadConfig(repo, cwd)).toStrictEqual({
    port: 4401,
    adapter: undefined,
    mainAgentModel: undefined,
    transcriptsDir: undefined,
    source: path.join(cwd, NAME),
  });
});

test("both present: repo wins, no merging", async () => {
  put(repo, "{}");
  put(cwd, '{"port": 4402}');
  expect(await loadConfig(repo, cwd)).toStrictEqual({
    port: undefined,
    adapter: undefined,
    mainAgentModel: undefined,
    transcriptsDir: undefined,
    source: path.join(repo, NAME),
  });
});

test("cwd defaults to process.cwd()", async () => {
  const saved = process.cwd();
  process.chdir(cwd);
  try {
    put(cwd, '{"port": 4403}');
    expect((await loadConfig(repo)).port).toBe(4403);
  } finally {
    process.chdir(saved);
  }
});

test("invalid JSON throws ConfigParseError with the file and parser message", async () => {
  put(repo, '{"port": ');
  const error = await loadConfig(repo, cwd).catch((e) => e);
  expect(error).toBeInstanceOf(ConfigParseError);
  expect(error.exitCode).toBe(1);
  expect(error.message.startsWith(`Invalid JSON in ${path.join(repo, NAME)}: `)).toBe(true);
  expect(error.message.length).toBeGreaterThan(`Invalid JSON in ${path.join(repo, NAME)}: `.length);
});

test("array top level throws ConfigValueError", async () => {
  put(repo, "[1]");
  const error = await loadConfig(repo, cwd).catch((e) => e);
  expect(error).toBeInstanceOf(ConfigValueError);
  expect(error.message).toContain(`Invalid config in ${path.join(repo, NAME)}: `);
  expect(error.message).toContain("object");
});

test("null and scalar top levels throw ConfigValueError", async () => {
  for (const body of ["null", "42", '"x"']) {
    put(repo, body);
    expect(await loadConfig(repo, cwd).catch((e) => e)).toBeInstanceOf(ConfigValueError);
  }
});

test.each(['"80"', "0", "70000", "12.5", "-3", "null", "true"])(
  "port %s throws ConfigValueError naming the file",
  async (value) => {
    put(repo, `{"port": ${value}}`);
    const error = await loadConfig(repo, cwd).catch((e) => e);
    expect(error).toBeInstanceOf(ConfigValueError);
    expect(error.message).toContain(path.join(repo, NAME));
    expect(error.message).toContain("port");
  },
);

test("port boundaries 1 and 65535 are accepted", async () => {
  put(repo, '{"port": 1}');
  expect((await loadConfig(repo, cwd)).port).toBe(1);
  put(repo, '{"port": 65535}');
  expect((await loadConfig(repo, cwd)).port).toBe(65535);
});

test("unknown keys are ignored", async () => {
  put(repo, '{"port": 4404, "theme": "dark", "nested": {"a": 1}}');
  expect(await loadConfig(repo, cwd)).toStrictEqual({
    port: 4404,
    adapter: undefined,
    mainAgentModel: undefined,
    transcriptsDir: undefined,
    source: path.join(repo, NAME),
  });
});

test("a config path that is a directory throws ConfigValueError", async () => {
  fs.mkdirSync(path.join(repo, NAME));
  expect(await loadConfig(repo, cwd).catch((e) => e)).toBeInstanceOf(ConfigValueError);
});

test("adapter is read from the same file as port", async () => {
  put(repo, '{"port": 4405, "adapter": "some-adapter"}');
  expect(await loadConfig(repo, cwd)).toStrictEqual({
    port: 4405,
    adapter: "some-adapter",
    mainAgentModel: undefined,
    transcriptsDir: undefined,
    source: path.join(repo, NAME),
  });
});

test("absent adapter is undefined", async () => {
  put(repo, '{"port": 4406}');
  expect((await loadConfig(repo, cwd)).adapter).toBeUndefined();
});

test.each(["5", '""', "null", "true", '["a"]'])(
  "adapter %s throws ConfigValueError with the exact message",
  async (value) => {
    put(repo, `{"adapter": ${value}}`);
    const error = (await loadConfig(repo, cwd).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(ConfigValueError);
    expect(error.message).toBe(
      `Invalid config in ${path.join(repo, NAME)}: "adapter" must be a non-empty string, got ${value}`,
    );
  },
);

test("port validation is unchanged when adapter is present", async () => {
  put(repo, '{"port": 0, "adapter": "x"}');
  const error = (await loadConfig(repo, cwd).catch((e: unknown) => e)) as Error;
  expect(error).toBeInstanceOf(ConfigValueError);
  expect(error.message).toContain('"port" must be an integer between 1 and 65535');
});

test("mainAgentModel and transcriptsDir are read from the file", async () => {
  put(repo, '{"mainAgentModel": "^claude-opus", "transcriptsDir": "/some/dir"}');
  const config = await loadConfig(repo, cwd);
  expect(config.mainAgentModel).toBe("^claude-opus");
  expect(config.transcriptsDir).toBe("/some/dir");
});

test.each(["mainAgentModel", "transcriptsDir"])(
  "%s as a number throws ConfigValueError naming it",
  async (name) => {
    put(repo, `{"${name}": 5}`);
    const error = (await loadConfig(repo, cwd).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(ConfigValueError);
    expect(error.message).toBe(
      `Invalid config in ${path.join(repo, NAME)}: "${name}" must be a non-empty string, got 5`,
    );
  },
);

test("an invalid regex string for mainAgentModel loads without error", async () => {
  put(repo, '{"mainAgentModel": "("}');
  expect((await loadConfig(repo, cwd)).mainAgentModel).toBe("(");
});
