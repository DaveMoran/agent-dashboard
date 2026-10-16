import { describe, expect, test } from "bun:test";
import path from "node:path";
import { createStubAdapter } from "../fixtures/stub/adapter";
import { assertKnownAdapter, createRegistry, selectAdapter, UnknownAdapterError } from "../src/core/registry";
import { FIXTURES } from "./helpers";

const ctx = { roots: [path.join(FIXTURES, "stub", "repo-a")] };

describe("registry", () => {
  test("a single matching adapter is selected", async () => {
    const reg = createRegistry([createStubAdapter({ name: "only" })]);
    const sel = await selectAdapter(reg, ctx);
    expect(sel.adapter?.name).toBe("only");
    expect(sel.matched).toEqual(["only"]);
    expect(sel.forced).toBe(false);
    expect(sel.warnings).toEqual([]);
    expect(sel.issues).toEqual([]);
  });

  test("with two matches the first registered wins, every time", async () => {
    const reg = createRegistry([createStubAdapter({ name: "first" }), createStubAdapter({ name: "second" })]);
    for (let i = 0; i < 10; i++) {
      const sel = await selectAdapter(reg, ctx);
      expect(sel.adapter?.name).toBe("first");
      expect(sel.matched).toEqual(["first", "second"]);
    }
  });

  test("no match gives adapter null", async () => {
    const reg = createRegistry([createStubAdapter({ name: "no", detect: false })]);
    const sel = await selectAdapter(reg, ctx);
    expect(sel.adapter).toBeNull();
    expect(sel.matched).toEqual([]);
    expect(sel.forced).toBe(false);
  });

  test("an empty registry gives adapter null", async () => {
    const sel = await selectAdapter(createRegistry([]), ctx);
    expect(sel.adapter).toBeNull();
  });

  test("forced adapter is selected even when another matches first", async () => {
    const reg = createRegistry([createStubAdapter({ name: "first" }), createStubAdapter({ name: "second" })]);
    const sel = await selectAdapter(reg, ctx, "second");
    expect(sel.adapter?.name).toBe("second");
    expect(sel.forced).toBe(true);
    expect(sel.warnings).toEqual([]);
  });

  test("forced adapter that does not detect is selected with a warning", async () => {
    const reg = createRegistry([
      createStubAdapter({ name: "first" }),
      createStubAdapter({ name: "second", detect: false }),
    ]);
    const sel = await selectAdapter(reg, ctx, "second");
    expect(sel.adapter?.name).toBe("second");
    expect(sel.forced).toBe(true);
    expect(sel.matched).toEqual(["first"]);
    expect(sel.warnings).toEqual(['Adapter "second" did not recognize this repo']);
  });

  test("forced unknown name throws UnknownAdapterError listing names", async () => {
    const reg = createRegistry([createStubAdapter({ name: "alpha" }), createStubAdapter({ name: "beta" })]);
    const err = await selectAdapter(reg, ctx, "nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownAdapterError);
    expect((err as UnknownAdapterError).message).toBe(
      'Unknown adapter "nope". Available adapters: alpha, beta',
    );
    expect((err as UnknownAdapterError).exitCode).toBe(1);
  });

  test("empty registry reports none registered", () => {
    expect(() => assertKnownAdapter("nope", createRegistry([]))).toThrow(
      'Unknown adapter "nope". Available adapters: none registered',
    );
  });

  test("assertKnownAdapter accepts undefined and registered names", () => {
    const reg = createRegistry([createStubAdapter({ name: "alpha" })]);
    expect(() => assertKnownAdapter(undefined, reg)).not.toThrow();
    expect(() => assertKnownAdapter("alpha", reg)).not.toThrow();
  });

  test("a throwing detect yields detect-failed and the next adapter is selected", async () => {
    const reg = createRegistry([
      createStubAdapter({ name: "broken", detect: "throw" }),
      createStubAdapter({ name: "good" }),
    ]);
    const sel = await selectAdapter(reg, ctx);
    expect(sel.adapter?.name).toBe("good");
    expect(sel.matched).toEqual(["good"]);
    expect(sel.issues).toHaveLength(1);
    expect(sel.issues[0]).toMatchObject({ kind: "detect-failed", related: ["broken"] });
    expect(sel.issues[0]!.message).toContain("stub detect failure");
  });

  test("duplicate names throw in createRegistry", () => {
    expect(() =>
      createRegistry([createStubAdapter({ name: "x" }), createStubAdapter({ name: "x" })]),
    ).toThrow('Duplicate adapter name "x"');
  });
});
