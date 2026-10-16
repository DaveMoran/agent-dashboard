import { expect, test } from "bun:test";
import { buildSessionsResponse } from "../src/server/sessions";
import { makeSession } from "./stub-agent-source";

const T = (t: string) => `2026-10-15T${t}.000Z`;

test("groups main sessions by project and sorts sessions and projects", () => {
  const res = buildSessionsResponse([
    makeSession({
      sessionId: "a1",
      projectId: "/a/.git",
      projectName: "a",
      cwd: "/a",
      lastActivity: T("10:00:00"),
    }),
    makeSession({
      sessionId: "b1",
      projectId: "/b/.git",
      projectName: "b",
      cwd: "/b",
      lastActivity: T("10:05:00"),
      state: "working",
      runningSubagents: 2,
      stateSince: T("10:04:00"),
    }),
    makeSession({
      sessionId: "a2",
      projectId: "/a/.git",
      projectName: "a",
      cwd: "/a/wt",
      lastActivity: T("10:03:00"),
    }),
  ]);
  expect(res).toStrictEqual({
    projects: [
      {
        id: "/b/.git",
        name: "b",
        lastActivity: T("10:05:00"),
        sessions: [
          {
            sessionId: "b1",
            model: "claude-opus-5-5",
            cwd: "/b",
            state: "working",
            runningSubagents: 2,
            stateSince: T("10:04:00"),
            lastActivity: T("10:05:00"),
          },
        ],
      },
      {
        id: "/a/.git",
        name: "a",
        lastActivity: T("10:03:00"),
        sessions: [
          {
            sessionId: "a2",
            model: "claude-opus-5-5",
            cwd: "/a/wt",
            state: "standby",
            runningSubagents: 0,
            stateSince: null,
            lastActivity: T("10:03:00"),
          },
          {
            sessionId: "a1",
            model: "claude-opus-5-5",
            cwd: "/a",
            state: "standby",
            runningSubagents: 0,
            stateSince: null,
            lastActivity: T("10:00:00"),
          },
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

// Part 2: the route
import { createHandler } from "../src/server/routes";
import { createStubAgentSource } from "./stub-agent-source";

function handler(source?: ReturnType<typeof createStubAgentSource>) {
  return createHandler({
    repo: { path: "/r", name: "r" },
    version: "0.0.0",
    webRoot: "/nonexistent",
    agentSource: source,
  });
}
const get = (h: ReturnType<typeof handler>) => h(new Request("http://x/api/sessions"));

const twoProjects = () => [
  makeSession({
    sessionId: "a1",
    projectId: "/a/.git",
    projectName: "a",
    cwd: "/a",
    lastActivity: T("10:00:00"),
  }),
  makeSession({
    sessionId: "b1",
    projectId: "/b/.git",
    projectName: "b",
    cwd: "/b",
    lastActivity: T("10:05:00"),
  }),
];

test("GET /api/sessions returns the built response as JSON", async () => {
  const res = await get(handler(createStubAgentSource(twoProjects())));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toStrictEqual(buildSessionsResponse(twoProjects()));
  const body = (await (await get(handler(createStubAgentSource(twoProjects())))).json()) as {
    projects: { id: string }[];
  };
  expect(body.projects.map((p) => p.id)).toEqual(["/b/.git", "/a/.git"]);
});

test("the next request reflects changed sessions", async () => {
  const source = createStubAgentSource(twoProjects());
  const h = handler(source);
  const first = (await (await get(h)).json()) as { projects: { sessions: { state: string }[] }[] };
  expect(first.projects[0]!.sessions[0]!.state).toBe("standby");
  source.setSessions([
    makeSession({
      sessionId: "b1",
      projectId: "/b/.git",
      projectName: "b",
      cwd: "/b",
      state: "working",
      lastActivity: T("10:06:00"),
    }),
  ]);
  const second = (await (await get(h)).json()) as {
    projects: { sessions: { state: string }[] }[];
  };
  expect(second.projects).toHaveLength(1);
  expect(second.projects[0]!.sessions[0]!.state).toBe("working");
});

test("POST /api/sessions is 405 with Allow: GET", async () => {
  const res = await handler(createStubAgentSource([]))(
    new Request("http://x/api/sessions", { method: "POST" }),
  );
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("GET");
});

test("a handler without a source returns no projects", async () => {
  const res = await get(handler());
  expect(res.status).toBe(200);
  expect(await res.json()).toStrictEqual({ projects: [] });
});

test("a waiting session is reported with state waiting", async () => {
  const res = await get(
    handler(
      createStubAgentSource([
        makeSession({
          sessionId: "w1",
          projectId: "/a/.git",
          projectName: "a",
          cwd: "/a",
          state: "waiting",
          stateSince: T("10:00:01"),
        }),
      ]),
    ),
  );
  const body = (await res.json()) as {
    projects: { sessions: { sessionId: string; state: string }[] }[];
  };
  expect(body.projects[0]!.sessions).toHaveLength(1);
  expect(body.projects[0]!.sessions[0]!.state).toBe("waiting");
});
