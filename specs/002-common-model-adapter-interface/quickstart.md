# Quickstart / Validation Guide: Common Spec Model and Adapter Contract

Runnable checks that the feature works. Contracts: [adapter](./contracts/adapter.md), [watcher](./contracts/watcher.md), [config-file](./contracts/config-file.md). Model and issue catalogue: [data-model](./data-model.md).

## 0. Prerequisites

Bun >= 1.2; `bun install` done.

## 1. Automated checks

```sh
bun run verify    # tsc + all tests, including the new core tests
```

Expected: all pass, including `tests/core-agnostic.test.ts` (no framework names in `src/core/`).

## 2. Validation rules on the invalid fixture (User Story 2)

```sh
bun test tests/validate.test.ts
```

Expected: one test per issue kind in the data-model catalogue, each asserting the exact kind, the spec id, and whether the spec was kept or excluded.

## 3. Live watching against a temp copy (User Story 4)

```sh
bun test tests/watcher.test.ts
```

Expected scenarios: initial notification; one change -> one `spec-changed`; 20 writes in 0.5 s -> one notification; a new `stub-specs/*.json` file is picked up; writing `FAIL` into a file -> `error` with the previous snapshot; fixing it -> `spec-changed`; after `stop()` no notifications; the temp repo is byte-identical before and after.

Manual spot check (optional): in a scratch script, call `watchSpecs` with the stub adapter on a copy of `fixtures/stub/repo-a`, log notifications, then edit and add files in another terminal.

## 4. Forced adapter in config (User Story 3)

```sh
mkdir -p /tmp/av002
echo '{"adapter": "nope"}' > /tmp/av002/agent-visualizer.config.json
bun src/cli/index.ts /tmp/av002          # exit 1: Unknown adapter "nope". Available adapters: none registered
echo '{"adapter": 5}' > /tmp/av002/agent-visualizer.config.json
bun src/cli/index.ts /tmp/av002          # exit 1: Invalid config ... "adapter" must be a non-empty string
rm /tmp/av002/agent-visualizer.config.json
bun src/cli/index.ts /tmp/av002          # starts normally; output unchanged from 001
```

## 5. Documentation check

`docs/adapters.md` explains the model, the three operations, registration and the `adapter` key; the README links to it; `docs/master-spec.md` points to it for the adapter contract.
