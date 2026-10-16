import { describe, expect, test } from "bun:test";
import path from "node:path";
import { pickAuthoritative } from "../src/adapters/speckit/authority";
import {
  groupFeatureFiles,
  parseFeatureDirName,
  type FeatureCopy,
} from "../src/adapters/speckit/feature-dir";
import { deriveStatus } from "../src/adapters/speckit/status";
import { parseTasks } from "../src/adapters/speckit/tasks";
import { parseTitle } from "../src/adapters/speckit/title";
import type { Task } from "../src/core/model";
import { FIXTURES } from "./helpers";

describe("parseTasks", () => {
  test("parses the tricky fixture: fences, decoys, indents, markers", async () => {
    const md = await Bun.file(path.join(FIXTURES, "speckit", "tasks-tricky.md")).text();
    expect(parseTasks(md)).toStrictEqual([
      { id: "T001", text: "Before any phase", done: false },
      { id: "T002", text: "Create the thing", done: true, parallel: true, phase: "Phase 1: Setup" },
      {
        id: "T003",
        text: "[US1] Marker after story",
        done: true,
        parallel: true,
        phase: "Phase 1: Setup",
      },
      { id: "T004", text: "Indented task", done: false, phase: "Phase 2: Core" },
      { id: "T005", text: "Upper-case X", done: true, phase: "Phase 2: Core" },
    ]);
  });

  test("keeps story tokens and drops [P] in any order", () => {
    expect(
      parseTasks("## Phase 2: Foundational\n- [x] T003 [P] [US1] Create the config loader"),
    ).toStrictEqual([
      {
        id: "T003",
        text: "[US1] Create the config loader",
        done: true,
        parallel: true,
        phase: "Phase 2: Foundational",
      },
    ]);
  });

  test("a plain task has only id, text and done", () => {
    expect(parseTasks("- [ ] T010 Write the docs")).toStrictEqual([
      { id: "T010", text: "Write the docs", done: false },
    ]);
  });

  test("empty input gives no tasks", () => {
    expect(parseTasks("")).toStrictEqual([]);
  });

  test("handles CRLF line endings", () => {
    const tasks = parseTasks("- [x] T001 A\r\n- [ ] T002 B\r\n");
    expect(tasks.map((t) => t.text)).toStrictEqual(["A", "B"]);
  });
});

describe("parseFeatureDirName", () => {
  test.each([
    ["003-speckit-adapter", { id: "003", dirName: "003-speckit-adapter" }],
    ["0042-x", { id: "0042", dirName: "0042-x" }],
    ["12-short", null],
    ["003-", null],
    ["notes", null],
  ])("%s", (name, expected) => {
    expect(parseFeatureDirName(name)).toStrictEqual(expected);
  });
});

describe("groupFeatureFiles", () => {
  test("one copy per root, in root order", () => {
    const copies = groupFeatureFiles(["/a", "/b"], ["/b/specs/003-x/spec.md", "/a/specs/003-x/spec.md"]);
    expect(copies).toStrictEqual([
      { root: "/a", dirName: "003-x", id: "003", files: ["specs/003-x/spec.md"] },
      { root: "/b", dirName: "003-x", id: "003", files: ["specs/003-x/spec.md"] },
    ]);
  });

  test("a file belongs to the longest matching root", () => {
    const copies = groupFeatureFiles(["/r", "/r/.wt/x"], ["/r/.wt/x/specs/001-y/spec.md"]);
    expect(copies).toStrictEqual([
      { root: "/r/.wt/x", dirName: "001-y", id: "001", files: ["specs/001-y/spec.md"] },
    ]);
  });

  test("ignores non-feature paths and directories without spec.md", () => {
    expect(
      groupFeatureFiles(["/a"], ["/a/specs/README.md", "/a/specs/notes/x.md", "/a/specs/009-z/plan.md"]),
    ).toStrictEqual([]);
  });

  test("files are relative and sorted", () => {
    const [copy] = groupFeatureFiles(["/a"], ["/a/specs/004-a/spec.md", "/a/specs/004-a/contracts/api.md"]);
    expect(copy!.files).toStrictEqual(["specs/004-a/contracts/api.md", "specs/004-a/spec.md"]);
  });
});

describe("parseTitle", () => {
  test.each([
    ["# Feature Specification: Spec Kit Adapter\n", "Spec Kit Adapter"],
    ["# feature specification:   Lower Case  \n", "Lower Case"],
    ["# No Plan Here\n", "No Plan Here"],
    ["# Feature Specification:\n", null],
    ["## Only a subheading\n\nText.\n", null],
    ["```\n# Inside\n```\n# Real\n", "Real"],
  ])("%j", (md, expected) => {
    expect(parseTitle(md)).toStrictEqual(expected);
  });
});

describe("deriveStatus", () => {
  const t = (done: boolean): Task => ({ id: "T001", text: "x", done });
  const base = { hasPlan: false, hasTasks: false, tasks: [] as Task[], merged: false };

  test("one case per row", () => {
    expect(deriveStatus({ ...base, merged: true, hasTasks: true, tasks: [t(true)] })).toBe("done");
    expect(deriveStatus({ ...base, hasTasks: true, tasks: [t(true), t(true)] })).toBe("review");
    expect(deriveStatus({ ...base, hasTasks: true, tasks: [t(true), t(false)] })).toBe("in-progress");
    expect(deriveStatus({ ...base, hasTasks: true, tasks: [t(false)] })).toBe("ready");
    expect(deriveStatus({ ...base, hasPlan: true })).toBe("planned");
    expect(deriveStatus(base)).toBe("drafted");
  });

  test("precedence", () => {
    expect(deriveStatus({ ...base, merged: true })).toBe("done");
    expect(deriveStatus({ ...base, hasTasks: true })).toBe("ready");
    expect(deriveStatus({ ...base, hasTasks: true, hasPlan: true, tasks: [t(true)] })).toBe("review");
  });
});

describe("pickAuthoritative", () => {
  const roots = ["/A", "/B", "/C"];
  const copy = (root: string): FeatureCopy => ({
    root,
    dirName: "003-x",
    id: "003",
    files: ["specs/003-x/spec.md"],
  });
  const pick = (copyRoots: string[], branches: Record<string, string | null>): string =>
    pickAuthoritative(copyRoots.map(copy), new Map(Object.entries(branches)), roots).root;

  test("a single copy wins", () => {
    expect(pick(["/A"], { "/A": "main" })).toBe("/A");
    expect(pick(["/B"], { "/B": "main" })).toBe("/B");
  });

  test("the root with the feature branch checked out wins", () => {
    expect(pick(["/A", "/B"], { "/A": "main", "/B": "003-x" })).toBe("/B");
    expect(pick(["/A", "/B"], { "/A": "003-x", "/B": "main" })).toBe("/A");
  });

  test("without a matching branch the first root wins", () => {
    expect(pick(["/A", "/B"], { "/A": "main", "/B": null })).toBe("/A");
    expect(pick(["/B", "/C"], { "/A": "main", "/B": "main", "/C": "main" })).toBe("/B");
  });

  test("copies given out of order still resolve by root order", () => {
    expect(pick(["/C", "/B"], { "/B": "main", "/C": "main" })).toBe("/B");
  });
});
