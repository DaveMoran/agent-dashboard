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

## The Spec Kit adapter

`speckit` (`src/adapters/speckit/`) is the first adapter and a second worked example next to `fixtures/stub/`. Its fixtures are in [`fixtures/speckit/`](../fixtures/speckit/).

**Detection.** A root matches when it has a `.specify/` folder, or a `specs/NNN-name/spec.md` file (`NNN` is three or more digits). It watches `specs/*/**` in every root.

**Fields.** Each `specs/NNN-name/` folder that has a `spec.md` becomes one spec. `id` is the digits as written, `title` is the first `# ` heading of `spec.md` without a leading `Feature Specification:` (no heading gives a `missing-title` issue and the id as title), `branch` is the folder name, and `artifacts` lists every file in the folder (paths relative to the root, sorted). Folders without `spec.md` and folders whose names do not start with three digits are ignored.

**Task lines.** A task is a line like `- [x] T012 [P] [US1] Text`: a `-` or `*` bullet (indent allowed), a checkbox (`x` or `X` is done), an id `T` plus digits, then optional bracket tokens and the text. `[P]` sets `parallel` and is dropped from the text; other tokens such as `[US1]` stay in the text. A heading `## Phase ...` sets the `phase` of the tasks below it. Lines inside fenced code blocks (``` or `~~~`) are ignored, as is everything else.

**Status.**

| Condition (first match wins) | Status |
|---|---|
| `tasks.md` on local `main` has at least one task and all are ticked | `done` |
| `tasks.md` has tasks and all are ticked | `review` |
| `tasks.md` has at least one ticked task | `in-progress` |
| `tasks.md` exists | `ready` |
| `plan.md` exists | `planned` |
| otherwise | `drafted` |

**The merged rule.** `done` means local `main` holds a fully ticked `tasks.md` for the feature. This covers merge commits, squash merges and deleted branches, and a freshly created branch is not `done`. After merging on GitHub, pull `main` locally so the adapter can see it. Without a `main` branch, or outside git, nothing is `done`.

**Worktrees.** `resolveRoots(repoPath)` (`src/git/worktrees.ts`) returns the path you gave first, then the repo's other worktrees; a worktree whose folder is gone stays in the list and is reported as `unreadable-path`. When a feature exists in several roots, the copy in the root that has the feature's branch checked out wins; otherwise the first root with a copy wins. `source` records that root and its checked-out branch (the branch is left out when detached).

**Read-only git.** All git access is in `src/git/` and goes through `runGit`, which runs `git -C <dir>` with `GIT_OPTIONAL_LOCKS=0`. Only `rev-parse`, `worktree list --porcelain`, `symbolic-ref` and `show` are used. Without git the adapter still works from files alone.

**Live check.** `bun run live-check [repo-path]` scans a real repo (default: this one) and prints its roots, specs and issues. It is on demand and not part of `bun test`.
