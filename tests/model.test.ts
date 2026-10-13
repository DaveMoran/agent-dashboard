import { describe, expect, test } from "bun:test";
import { ROLES, STATUSES, type Role } from "../src/core/model";
import { validateEvent } from "../src/core/validate";

const base = {
  ts: "2026-10-12T09:30:00Z",
  role: "coder" as Role,
  kind: "bash",
  detail: { cmd: "ls" },
};

describe("shared constants", () => {
  test("STATUSES is the exact list", () => {
    expect([...STATUSES]).toEqual([
      "drafted",
      "planned",
      "ready",
      "in-progress",
      "review",
      "done",
      "blocked",
    ]);
  });

  test("ROLES is the exact list", () => {
    expect([...ROLES]).toEqual(["planner", "coder", "human", "git"]);
  });
});

describe("validateEvent", () => {
  test.each(["planner", "coder", "human", "git"] as Role[])("accepts role %s with and without specId", (role) => {
    const without = validateEvent({ ...base, role });
    expect(without).toEqual({ ok: true, event: { ...base, role } });
    const withId = validateEvent({ ...base, role, specId: "002" });
    expect(withId).toEqual({ ok: true, event: { ...base, role, specId: "002" } });
  });

  test("drops unknown fields and passes detail through untouched", () => {
    const detail = { nested: [1, { a: null }] };
    const result = validateEvent({ ...base, detail, junk: true });
    expect(result).toEqual({ ok: true, event: { ...base, detail } });
  });

  test.each([
    ["missing ts", { ...base, ts: undefined }, "ts"],
    ["ts that is not a date", { ...base, ts: "yesterday" }, "ts"],
    ["unknown role", { ...base, role: "robot" }, "role"],
    ["empty kind", { ...base, kind: "" }, "kind"],
    ["numeric specId", { ...base, specId: 7 }, "specId"],
  ])("rejects %s with a reason naming the field", (_label, raw, field) => {
    const result = validateEvent(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(`"${field}"`);
  });

  test("rejects non-objects", () => {
    for (const raw of [null, "x", 3, [base]]) {
      expect(validateEvent(raw).ok).toBe(false);
    }
  });
});
