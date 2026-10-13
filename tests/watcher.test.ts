import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createStubAdapter } from "../fixtures/stub/adapter";
import type { Adapter } from "../src/core/adapter";
import { type Notification, type SpecWatcher, watchSpecs } from "../src/core/watcher";
import { cleanupFixtures, copyFixture } from "./helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const open: SpecWatcher[] = [];

afterEach(async () => {
  while (open.length > 0) await open.pop()!.stop();
  await cleanupFixtures();
});

interface Session {
  watcher: SpecWatcher;
  next(timeoutMs?: number): Promise<Notification>;
  /** Resolves with everything received during `ms`. */
  quiet(ms: number): Promise<Notification[]>;
  drain(): Notification[];
}

async function start(
  roots: string[],
  extra: { debounceMs?: number; maxWaitMs?: number; adapter?: Adapter } = {},
): Promise<Session> {
  const queue: Notification[] = [];
  let wake: (() => void) | null = null;
  const watcher = await watchSpecs({
    adapter: extra.adapter ?? createStubAdapter(),
    ctx: { roots },
    debounceMs: extra.debounceMs,
    maxWaitMs: extra.maxWaitMs,
    onNotification: (n) => {
      queue.push(n);
      wake?.();
    },
  });
  open.push(watcher);
  const session: Session = {
    watcher,
    async next(timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      while (queue.length === 0) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error("timed out waiting for a notification");
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, left);
          wake = () => {
            clearTimeout(t);
            resolve();
          };
        });
        wake = null;
      }
      return queue.shift()!;
    },
    async quiet(ms) {
      await sleep(ms);
      return queue.splice(0);
    },
    drain: () => queue.splice(0),
  };
  return session;
}

/** Start, take the initial notification, and let any stale OS events settle. */
async function startSettled(roots: string[], extra = {}, settleMs = 400): Promise<Session> {
  const s = await start(roots, extra);
  // Keep waiting until a whole window passes with no (stale) notification.
  do {
    await sleep(settleMs);
  } while (s.drain().length > 0);
  return s;
}

function spec(root: string, name: string) {
  return path.join(root, "stub-specs", name);
}

async function editTitle(root: string, name: string, title: string) {
  const file = spec(root, name);
  const json = JSON.parse(await readFile(file, "utf8"));
  json.title = title;
  await writeFile(file, JSON.stringify(json));
}

describe("watchSpecs", () => {
  test("initial notification arrives first with the 3 specs", async () => {
    const root = await copyFixture("stub/repo-a");
    const s = await start([root]);
    const first = await s.next();
    expect(first.type).toBe("initial");
    if (first.type === "initial") {
      expect(first.snapshot.specs.map((x) => x.id)).toEqual(["001", "002", "003"]);
    }
    expect(s.watcher.current().specs).toHaveLength(3);
  });

  test("editing a title gives one spec-changed within 1s", async () => {
    const root = await copyFixture("stub/repo-a");
    const s = await start([root]);
    await s.next(); // initial
    await sleep(400);
    s.drain();
    const t0 = Date.now();
    await editTitle(root, "002.json", "Renamed");
    const n = await s.next(1000);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(n.type).toBe("spec-changed");
    if (n.type === "spec-changed") {
      expect(n.snapshot.specs.find((x) => x.id === "002")!.title).toBe("Renamed");
    }
    expect(s.watcher.current().specs.find((x) => x.id === "002")!.title).toBe("Renamed");
    expect(await s.quiet(400)).toEqual([]);
  });

  test("20 rapid writes give exactly one notification", async () => {
    const root = await copyFixture("stub/repo-a");
    const s = await startSettled([root]);
    s.drain();
    for (let i = 0; i < 20; i++) {
      await editTitle(root, "001.json", `Title ${i}`);
      await sleep(20);
    }
    const first = await s.next(2000);
    expect(first.type).toBe("spec-changed");
    if (first.type === "spec-changed") {
      expect(first.snapshot.specs.find((x) => x.id === "001")!.title).toBe("Title 19");
    }
    expect(await s.quiet(500)).toEqual([]);
  });

  test("a new spec file adds the spec", async () => {
    const root = await copyFixture("stub/repo-a");
    const s = await startSettled([root]);
    s.drain();
    await writeFile(
      spec(root, "005.json"),
      JSON.stringify({ id: "005", title: "Fifth", status: "drafted" }),
    );
    const n = await s.next(2000);
    expect(n.type).toBe("spec-changed");
    expect(s.watcher.current().specs.map((x) => x.id)).toEqual(["001", "002", "003", "005"]);
  });

  test("a parse failure emits error, keeps the last good snapshot, and recovers", async () => {
    const root = await copyFixture("stub/repo-a");
    const s = await startSettled([root]);
    s.drain();
    const before = s.watcher.current();
    await writeFile(spec(root, "003.json"), "FAIL");
    const n = await s.next(2000);
    expect(n.type).toBe("error");
    if (n.type === "error") {
      expect(n.error.stage).toBe("parse");
      expect(n.error.message).toContain("stub parse failure");
      expect(n.snapshot.specs).toHaveLength(3);
    }
    expect(s.watcher.current()).toBe(before);
    await sleep(300);
    s.drain();

    await writeFile(
      spec(root, "003.json"),
      JSON.stringify({ id: "003", title: "Fixed", status: "ready" }),
    );
    const ok = await s.next(2000);
    expect(ok.type).toBe("spec-changed");
    expect(s.watcher.current().specs.find((x) => x.id === "003")!.title).toBe("Fixed");
  });

  test("a change written while a scan is in flight yields a later spec-changed with the new content", async () => {
    const root = await copyFixture("stub/repo-a");
    const adapter = createStubAdapter({ parseDelayMs: 500 });
    const s = await startSettled([root], { adapter }, 1000);
    s.drain();
    await editTitle(root, "001.json", "A");
    await sleep(400); // the scan for "A" has read its files and is waiting to parse
    await editTitle(root, "001.json", "B");

    const titles: string[] = [];
    const deadline = Date.now() + 5000;
    while (!titles.includes("B") && Date.now() < deadline) {
      const n = await s.next(3000);
      expect(n.type).toBe("spec-changed");
      if (n.type === "spec-changed") {
        titles.push(n.snapshot.specs.find((x) => x.id === "001")!.title);
      }
    }
    expect(titles[0]).toBe("A"); // the in-flight scan saw the old content
    expect(titles[titles.length - 1]).toBe("B");
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(s.watcher.current().specs.find((x) => x.id === "001")!.title).toBe("B");
  });

  test("a change during the initial scan shows up without any further change", async () => {
    const root = await copyFixture("stub/repo-a");
    const adapter = createStubAdapter({ parseDelayMs: 800 });
    const pending = start([root], { adapter });
    await sleep(300); // the initial scan has read its files and is waiting to parse
    await editTitle(root, "001.json", "During initial");
    const s = await pending;

    const first = await s.next();
    expect(first.type).toBe("initial");
    if (first.type === "initial") {
      expect(first.snapshot.specs.find((x) => x.id === "001")!.title).toBe("First");
    }
    const followUp = await s.next(3000);
    expect(followUp.type).toBe("spec-changed");
    if (followUp.type === "spec-changed") {
      expect(followUp.snapshot.specs.find((x) => x.id === "001")!.title).toBe("During initial");
    }
    expect(s.watcher.current().specs.find((x) => x.id === "001")!.title).toBe("During initial");
  });

  test("a failing first scan emits error with an empty snapshot", async () => {
    const root = await copyFixture("stub/repo-a");
    await writeFile(spec(root, "001.json"), "FAIL");
    const s = await start([root]);
    const n = await s.next();
    expect(n.type).toBe("error");
    if (n.type === "error") {
      expect(n.error.stage).toBe("parse");
      expect(n.snapshot.specs).toEqual([]);
    }
    expect(s.watcher.current().specs).toEqual([]);
  });

  test("continuous writes still notify within maxWaitMs", async () => {
    const root = await copyFixture("stub/repo-a");
    const s = await startSettled([root], { debounceMs: 150, maxWaitMs: 1000 });
    s.drain();
    const t0 = Date.now();
    let writing = true;
    const writer = (async () => {
      let i = 0;
      while (writing) {
        await editTitle(root, "001.json", `Busy ${i++}`);
        await sleep(50);
      }
    })();
    try {
      const n = await s.next(3000);
      expect(n.type).toBe("spec-changed");
      expect(Date.now() - t0).toBeLessThan(1000 + 500);
      expect(Date.now() - t0).toBeGreaterThan(500); // quiet timer never fired on its own
    } finally {
      writing = false;
      await writer;
    }
  });

  test("after stop() writes produce no notification", async () => {
    const root = await copyFixture("stub/repo-a");
    const s = await startSettled([root]);
    s.drain();
    await s.watcher.stop();
    await editTitle(root, "001.json", "After stop");
    expect(await s.quiet(1000)).toEqual([]);
  });

  test("changes under node_modules/ produce no notification", async () => {
    const root = await copyFixture("stub/repo-a");
    const s = await startSettled([root]);
    s.drain();
    await mkdir(path.join(root, "node_modules", "stub-specs"), { recursive: true });
    await writeFile(
      path.join(root, "node_modules", "stub-specs", "9.json"),
      JSON.stringify({ id: "9", title: "Nope", status: "drafted" }),
    );
    expect(await s.quiet(800)).toEqual([]);
  });

  test("a watch session never writes into an observed root", async () => {
    const observed = await copyFixture("stub/repo-a");
    const driver = await copyFixture("stub/repo-b");

    async function fingerprint(dir: string) {
      const out: Record<string, string> = {};
      for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const file = path.join(entry.parentPath, entry.name);
        const info = await stat(file);
        out[file] = `${info.mtimeMs}:${await readFile(file, "utf8")}`;
      }
      return out;
    }

    const before = await fingerprint(observed);
    // `driver` is a second root; edits there trigger rescans that also read `observed`.
    const s = await startSettled([observed, driver]);
    s.drain();
    await editTitle(driver, "004.json", "Changed");
    expect((await s.next(2000)).type).toBe("spec-changed");
    await s.watcher.stop();
    expect(await fingerprint(observed)).toEqual(before);
  });
});
