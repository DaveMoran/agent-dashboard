import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTranscriptSource } from "../src/agents/transcripts/source";
import { createMagiService, type MagiService } from "../src/magi/service";
import { addWorktree, commitAll, makeGitRepo, snapshotTree } from "./git-helpers";
import { cleanupFixtures, FIXTURES, trackTempDir } from "./helpers";
import { materializeTranscripts } from "./transcript-fixtures";

const IDLE = 30 * 60_000;
const WAITING = 240 * 60_000;
const at = (t: string): number => Date.parse(`2026-10-15T${t}Z`);

type Source = ReturnType<typeof createTranscriptSource>;
const sources: Source[] = [];
const services: MagiService[] = [];

afterEach(async () => {
  for (const s of services.splice(0)) s.stop();
  while (sources.length > 0) await sources.pop()!.stop();
  await cleanupFixtures();
});

async function run(scenario: string) {
  const REPO = await makeGitRepo();
  await commitAll(REPO, "init");
  const WORKTREE = await addWorktree(REPO, { newBranch: "wt" });
  const PLAIN = await realpath(await mkdtemp(path.join(os.tmpdir(), "av-plain-")));
  trackTempDir(PLAIN);
  const root = await materializeTranscripts(scenario, {
    REPO,
    WORKTREE,
    PLAIN,
    MISSING: `${PLAIN}/gone`,
  });
  const source = createTranscriptSource({
    root,
    mainAgentPattern: /^claude-(opus|fable)/,
    pollIntervalMs: 0,
  });
  sources.push(source);
  await source.start();
  let now = 0;
  const service = createMagiService({
    source,
    idleMs: IDLE,
    waitingMs: WAITING,
    now: () => now,
    tickMs: 3_600_000,
  });
  services.push(service);
  service.start();
  return {
    REPO,
    at(ms: number) {
      now = ms;
      service.refresh();
      return service.brains();
    },
  };
}

describe("US2 fixtures through the real transcript source", () => {
  test("two-worktrees: one project on MELCHIOR, working, at the repo's main checkout", async () => {
    const env = await run("two-worktrees");
    const brains = env.at(at("10:10:00.000"));
    expect(brains).toHaveLength(3);
    expect(brains[0]!.name).toBe("MELCHIOR");
    expect(brains[0]!.state).toBe("working");
    expect(brains[0]!.project!.path).toBe(env.REPO);
    expect(brains[0]!.project!.id).toBe(`${env.REPO}/.git`);
    expect(brains[1]).toStrictEqual({
      number: 2,
      name: "BALTHASAR",
      state: "not-active",
      stateSince: null,
      project: null,
    });
    expect(brains[2]).toStrictEqual({
      number: 3,
      name: "CASPER",
      state: "not-active",
      stateSince: null,
      project: null,
    });
  });

  test("two-worktrees: 31 min after the repo session's last activity MELCHIOR is not-active", async () => {
    const env = await run("two-worktrees");
    const now = at("10:05:00.000") + 31 * 60_000;
    const brains = env.at(now);
    expect(brains.map((b) => b.state)).toEqual(["not-active", "not-active", "not-active"]);
    expect(brains.map((b) => b.project)).toEqual([null, null, null]);
  });

  test("non-main: 1 min after the latest line all three brains are not-active", async () => {
    const env = await run("non-main");
    const brains = env.at(at("10:00:05.000") + 60_000);
    expect(brains.map((b) => b.state)).toEqual(["not-active", "not-active", "not-active"]);
    expect(brains.map((b) => b.project)).toEqual([null, null, null]);
  });

  test("nothing under fixtures/ changes", async () => {
    const dir = path.join(FIXTURES, "transcripts");
    const before = await snapshotTree([dir]);
    expect(before.length).toBeGreaterThan(0);
    const env = await run("two-worktrees");
    env.at(at("10:10:00.000"));
    const env2 = await run("non-main");
    env2.at(at("10:01:00.000"));
    expect(await snapshotTree([dir])).toEqual(before);
  });
});
