# Quickstart / Validation Guide: Server Skeleton

Runnable scenarios that prove the feature works end to end. Contracts: [cli](./contracts/cli.md), [http-api](./contracts/http-api.md), [config-file](./contracts/config-file.md), [server-json](./contracts/server-json.md).

## 0. Prerequisites

Bun >= 1.2 must be installed (`bun --version`). It was not installed on the dev machine when this plan was written; install it (e.g. `brew install oven-sh/bun/bun`) before starting implementation.

```sh
bun install
```

## 1. Automated checks

```sh
bun test            # all unit, integration and e2e tests pass
bun run build       # produces dist/web/index.html
```

## 2. Launch and see the repo name (User Story 1)

```sh
mkdir -p /tmp/av-demo
bun run build
bun src/cli/index.ts /tmp/av-demo
```
Expected: prints the three startup lines; opening the printed address shows `av-demo`.
```sh
curl -s http://127.0.0.1:<port>/api/health
```
Expected: `{"status":"ok","repoPath":"/private/tmp/av-demo","repoName":"av-demo","version":"0.1.0"}` (macOS resolves `/tmp` to `/private/tmp`).

Invalid inputs (each exits non-zero with a specific message):
```sh
bun src/cli/index.ts                       # usage, exit 2
bun src/cli/index.ts /does/not/exist       # not found, exit 1
bun src/cli/index.ts package.json          # not a directory, exit 1
bun src/cli/index.ts /tmp/av-demo --port abc   # invalid port, exit 2
```

## 3. Port handling (User Story 2)

```sh
bun src/cli/index.ts /tmp/av-demo --port 4400            # listens on 4400
# in another terminal, with the first still running:
bun src/cli/index.ts /tmp/av-demo --port 4400            # exits 1: instance already running at http://127.0.0.1:4400
mkdir -p /tmp/av-demo2 && bun src/cli/index.ts /tmp/av-demo2 --port 4400   # falls back to a free port and prints it
```

## 4. Discovery record (User Story 3)

While an instance runs:
```sh
ls ~/.agent-visualizer/instances/*/server.json
cat ~/.agent-visualizer/instances/av-demo-*/server.json
```
Expected: port/pid/repoPath/startedAt/version match the running instance. Press Ctrl+C; the file is gone. Confirm `/tmp/av-demo` contains no new files. After `kill -9 <pid>` the file remains; the next start for the same repo replaces it.

## 5. Config file (User Story 4)

```sh
echo '{"port": 4410}' > /tmp/av-demo/agent-visualizer.config.json
bun src/cli/index.ts /tmp/av-demo                 # uses 4410
bun src/cli/index.ts /tmp/av-demo --port 4411     # flag wins: 4411
echo '{oops' > /tmp/av-demo/agent-visualizer.config.json
bun src/cli/index.ts /tmp/av-demo                 # exits 1 naming the file
```

## 6. Development mode (User Story 5)

```sh
bun run dev -- /tmp/av-demo
```
Expected: UI reachable at the printed address; editing `src/web/App.tsx` updates the browser without restarting the server.

## 7. Documentation check

README documents install, usage, flags, config file, state directory/`server.json`, and the three scripts; `docs/master-spec.md` still matches (stack and state-dir decisions).
