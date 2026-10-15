import { describe, expect, test } from "bun:test";
import type { AgentSourceEvent } from "../src/agents/source";
import { createStubAgentSource, makeSession } from "./stub-agent-source";

const event = (): AgentSourceEvent => ({
  type: "session-added",
  session: makeSession(),
});

describe("stub agent source", () => {
  test("subscribed listener gets an emitted event", () => {
    const src = createStubAgentSource([]);
    const got: AgentSourceEvent[] = [];
    src.subscribe((e) => got.push(e));
    const e = event();
    src.emit(e);
    expect(got).toEqual([e]);
  });

  test("after unsubscribe the listener gets nothing", () => {
    const src = createStubAgentSource([]);
    const got: AgentSourceEvent[] = [];
    const off = src.subscribe((e) => got.push(e));
    off();
    src.emit(event());
    expect(got).toEqual([]);
  });

  test("a throwing listener does not stop a second listener", () => {
    const src = createStubAgentSource([]);
    const got: AgentSourceEvent[] = [];
    src.subscribe(() => {
      throw new Error("boom");
    });
    src.subscribe((e) => got.push(e));
    src.emit(event());
    expect(got.length).toBe(1);
  });

  test("after stop nothing is delivered", async () => {
    const src = createStubAgentSource([]);
    const got: AgentSourceEvent[] = [];
    src.subscribe((e) => got.push(e));
    await src.stop();
    src.emit(event());
    expect(got).toEqual([]);
  });

  test("sessions() returns a copy", () => {
    const src = createStubAgentSource([makeSession()]);
    src.sessions().pop();
    expect(src.sessions().length).toBe(1);
  });
});
