import { expect, test } from "bun:test";
import { buildSessionsResponse } from "../src/server/sessions";
import { makeSession } from "./stub-agent-source";

const T = (t: string) => `2026-10-15T${t}.000Z`;

test("groups main sessions by project and sorts sessions and projects", () => {
  const res = buildSessionsResponse([
    makeSession({ sessionId: "a1", projectId: "/a/.git", projectName: "a", cwd: "/a", lastActivity: T("10:00:00") }),
    makeSession({ sessionId: "b1", projectId: "/b/.git", projectName: "b", cwd: "/b", lastActivity: T("10:05:00"), state: "working", runningSubagents: 2, stateSince: T("10:04:00") }),
    makeSession({ sessionId: "a2", projectId: "/a/.git", projectName: "a", cwd: "/a/wt", lastActivity: T("10:03:00") }),
  ]);
  expect(res).toStrictEqual({
    projects: [
      {
        id: "/b/.git",
        name: "b",
        lastActivity: T("10:05:00"),
        sessions: [
          { sessionId: "b1", model: "claude-opus-5-5", cwd: "/b", state: "working", runningSubagents: 2, stateSince: T("10:04:00"), lastActivity: T("10:05:00") },
        ],
      },
      {
        id: "/a/.git",
        name: "a",
        lastActivity: T("10:03:00"),
        sessions: [
          { sessionId: "a2", model: "claude-opus-5-5", cwd: "/a/wt", state: "standby", runningSubagents: 0, stateSince: null, lastActivity: T("10:03:00") },
          { sessionId: "a1", model: "claude-opus-5-5", cwd: "/a", state: "standby", runningSubagents: 0, stateSince: null, lastActivity: T("10:00:00") },
        ],
      },
    ],
  });
});

test("non-main sessions and projects with only non-main sessions are excluded", () => {
  const res = buildSessionsResponse([
    makeSession({ sessionId: "m", projectId: "/a/.git", projectName: "a" }),
    makeSession({ sessionId: "x", projectId: "/a/.git", projectName: "a", isMain: false }),
    makeSession({ sessionId: "y", projectId: "/z", projectName: "z", isMain: false }),
  ]);
  expect(res.projects.map((p) => p.id)).toEqual(["/a/.git"]);
  expect(res.projects[0]!.sessions.map((s) => s.sessionId)).toEqual(["m"]);
});

test("empty input gives no projects", () => {
  expect(buildSessionsResponse([])).toStrictEqual({ projects: [] });
});

test("ties on lastActivity sort by id ascending", () => {
  const res = buildSessionsResponse([
    makeSession({ sessionId: "s2", projectId: "/p2", projectName: "p2" }),
    makeSession({ sessionId: "s9", projectId: "/p1", projectName: "p1" }),
    makeSession({ sessionId: "s1", projectId: "/p1", projectName: "p1" }),
  ]);
  expect(res.projects.map((p) => p.id)).toEqual(["/p1", "/p2"]);
  expect(res.projects[0]!.sessions.map((s) => s.sessionId)).toEqual(["s1", "s9"]);
});
