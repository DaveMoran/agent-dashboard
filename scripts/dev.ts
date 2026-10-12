export {};

const VITE_URL = "http://127.0.0.1:5173";
const READY_TIMEOUT_MS = 15_000;

// `bun run dev -- <args>` may or may not hand the "--" through; drop it either way.
const args = process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--"));

const vite = Bun.spawn(["bunx", "vite"], { stdout: "inherit", stderr: "inherit" });
let server: ReturnType<typeof Bun.spawn> | undefined;
let stopping = false;

function stopAll(signal: NodeJS.Signals = "SIGTERM") {
  stopping = true;
  server?.kill(signal);
  vite.kill("SIGTERM");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    stopAll(signal);
    await Promise.all([vite.exited, server?.exited]);
    process.exit(0);
  });
}

async function viteAnswers(): Promise<boolean> {
  try {
    await fetch(VITE_URL, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

void vite.exited.then((code) => {
  if (stopping) return;
  console.error(`Vite exited unexpectedly (code ${code}).`);
  stopAll();
  process.exit(typeof code === "number" && code !== 0 ? code : 1);
});

const deadline = Date.now() + READY_TIMEOUT_MS;
while (!(await viteAnswers())) {
  if (Date.now() > deadline) {
    console.error(`Vite did not answer at ${VITE_URL} within ${READY_TIMEOUT_MS / 1000}s.`);
    stopAll();
    process.exit(1);
  }
  await Bun.sleep(150);
}

server = Bun.spawn(["bun", "src/cli/index.ts", ...args], {
  env: { ...process.env, AGENT_VISUALIZER_DEV_UI: VITE_URL },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const code = await server.exited;
if (!stopping) {
  stopAll();
  await vite.exited;
}
process.exit(code);
