import { describe, expect, test } from "bun:test";
import path from "node:path";
import { parseTasks } from "../src/adapters/speckit/tasks";
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
    expect(parseTasks("## Phase 2: Foundational\n- [x] T003 [P] [US1] Create the config loader")).toStrictEqual([
      { id: "T003", text: "[US1] Create the config loader", done: true, parallel: true, phase: "Phase 2: Foundational" },
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
