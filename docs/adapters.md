# Spec adapters

An **adapter** teaches Agent Visualizer how one spec framework lays out its files. The core never knows which framework it is looking at: an adapter finds the spec files, reads them, and hands back specs in one shared shape. The core validates that output, builds a snapshot and watches for changes.

The full field-by-field definitions live in [`specs/002-common-model-adapter-interface/data-model.md`](../specs/002-common-model-adapter-interface/data-model.md); the contracts are in [`specs/002-common-model-adapter-interface/contracts/`](../specs/002-common-model-adapter-interface/contracts/).

## The shared model

A spec has `id`, `title`, `status`, `dependsOn[]`, `tasks[]`, `artifacts[]` and optionally `branch` and `source` (`{ root, branch? }`, the root it was read from). A task has `id`, `text`, `done` and optionally `phase` and `parallel`.

`status` is one of `drafted`, `planned`, `ready`, `in-progress`, `review`, `done`, `blocked`. Anything else is rejected. Unknown fields in adapter output are dropped.

Events (`ts`, `role`, `specId?`, `kind`, `detail`) share the model too: `role` is `planner`, `coder`, `human` or `git`, and `ts` must be a date string. `validateEvent` in `src/core/validate.ts` checks them.

## The three operations

```ts
interface Adapter {
  name: string;                                   // unique, lowercase-kebab
  detect(ctx: RepoContext): Promise<boolean>;
  discover(ctx: RepoContext): Promise<WatchTarget[]>;
  parse(ctx: RepoContext, files: string[]): Promise<unknown[]>;
}
```

- **`detect`** returns true when the framework is present in any root. Keep it fast and read-only. If it throws, the adapter counts as not matching and a `detect-failed` issue is recorded.
- **`discover`** returns, per root, glob patterns relative to that root (for example `specs/*/spec.md`). It may return `[]`.
- **`parse`** receives the absolute paths of every matching file, sorted, and returns raw spec objects. Set `source.root` on each. Throwing means the scan failed: the watcher reports an error and keeps the last good snapshot.

Adapters must never write anywhere and must not import from `src/server/` or `src/cli/`.

## Patterns and multiple roots

`ctx.roots` has one entry for a plain repo and several when a repo has multiple worktrees. Each `WatchTarget` names one root and its patterns. Patterns are matched with `Bun.Glob` using `/` separators. Paths under `.git/` and `node_modules/` are never matched. The watcher watches every root recursively and re-reads the patterns on every scan, so new targets need no restart.

## What validation does with bad output

Bad adapter output never crashes the core. It becomes an issue in the snapshot:

| Issue | Meaning | Effect |
|---|---|---|
| `invalid-shape` | Not an object, missing or empty `id`, or a wrong-typed list entry | Spec dropped if the `id` is unusable; otherwise the bad entry is dropped |
| `missing-title` | No usable title | Kept, title = id |
| `invalid-status` | Status not in the vocabulary | Spec dropped |
| `invalid-task` | Task missing `id`, `text` or `done`, or wrong types | Task dropped, spec kept |
| `duplicate-task-id` | Two tasks in one spec share an id | Both kept |
| `duplicate-id` | Spec id already seen | First kept, later dropped |
| `unresolved-dependency` | `dependsOn` names an unknown spec | Kept |
| `self-dependency` | Spec depends on itself | Kept |
| `dependency-cycle` | Two or more specs depend on each other in a loop | Kept; one issue per cycle |
| `unreadable-path` | A root or file cannot be read or watched | Scan continues |
| `detect-failed` | An adapter's `detect` threw | Adapter treated as not matching |

Issues come back in a fixed order: per-spec issues in adapter order, then duplicate ids, then dependency issues sorted by spec id.

## Registering an adapter

Add it to the array in `src/adapters/index.ts`:

```ts
import { myAdapter } from "./my-adapter";
export const adapters: Adapter[] = [myAdapter];
```

Names must be unique. At startup the first registered adapter whose `detect` returns true is used.

## Choosing an adapter in config

By default the first matching adapter wins. To force one, set `adapter` in `agent-visualizer.config.json`:

```json
{ "adapter": "my-adapter" }
```

- A value that is not a non-empty string exits 1 with `Invalid config in <file>: "adapter" must be a non-empty string, got <value>`.
- A name that is not registered exits 1 with `Unknown adapter "<name>". Available adapters: <names>` (or `none registered`).
- A forced adapter whose `detect` returns false is still used, with the warning `Adapter "<name>" did not recognize this repo`.

## Testing an adapter

Use fixtures, never the real repo. [`fixtures/stub/`](../fixtures/stub/) is the worked example: `fixtures/stub/adapter.ts` is a tiny JSON-file adapter, `repo-a` and `repo-b` hold valid specs, and `invalid` holds one file per validation problem. Tests that change files must work on a copy in a temp directory (see `tests/helpers.ts`), never on the fixture itself. Run an adapter through `scan(adapter, { roots })` from `src/core/scan.ts` and assert exact specs and issues, as `tests/scan.test.ts` and `tests/validate.test.ts` do.
