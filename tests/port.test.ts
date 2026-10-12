import { expect, test } from "bun:test";
import { listenWithFallback } from "../src/server/port.js";

const listen = (port: number) =>
  Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("x") });

test("falls back to a different free port when the requested one is taken", () => {
  const occupier = listen(0);
  const servers = [occupier];
  try {
    const result = listenWithFallback(occupier.port as number, listen);
    servers.push(result.server);
    expect(result.fellBack).toBe(true);
    expect(result.server.port).not.toBe(occupier.port);
    expect(result.server.port).toBeGreaterThan(0);
  } finally {
    for (const s of servers) s.stop(true);
  }
});

test("uses the requested port when it is free", () => {
  const probe = listen(0);
  const free = probe.port as number;
  probe.stop(true);
  const result = listenWithFallback(free, listen);
  try {
    expect(result.fellBack).toBe(false);
    expect(result.server.port).toBe(free);
  } finally {
    result.server.stop(true);
  }
});

test("falls back when the error only carries EADDRINUSE in its message", () => {
  const calls: number[] = [];
  const result = listenWithFallback(1234, (port) => {
    calls.push(port);
    if (port === 1234) throw new Error("listen EADDRINUSE: address already in use");
    return "ok";
  });
  expect(calls).toEqual([1234, 0]);
  expect(result).toEqual({ server: "ok", fellBack: true });
});

test("rethrows errors that are not EADDRINUSE without retrying", () => {
  const calls: number[] = [];
  const boom = Object.assign(new Error("permission denied"), { code: "EACCES" });
  expect(() =>
    listenWithFallback(80, (port) => {
      calls.push(port);
      throw boom;
    }),
  ).toThrow(boom);
  expect(calls).toEqual([80]);
});

test("rethrows when the fallback listen itself fails", () => {
  const inUse = Object.assign(new Error("in use"), { code: "EADDRINUSE" });
  const other = new Error("no sockets left");
  expect(() =>
    listenWithFallback(1234, (port) => {
      throw port === 0 ? other : inUse;
    }),
  ).toThrow(other);
});
