# Contract: Spec Kit Adapter

Defined in `src/adapters/speckit/`. Implements the 002 `Adapter` interface ([contract](../../002-common-model-adapter-interface/contracts/adapter.md)). Registered in `src/adapters/index.ts` as `adapters = [speckitAdapter]`, name `"speckit"`.

## Pure helpers

```ts
// feature-dir.ts
export const FEATURE_DIR_RE: RegExp;                 // /^(\d{3,})-(.+)$/
export function parseFeatureDirName(name: string): { id: string; dirName: string } | null;
export function groupFeatureFiles(roots: string[], absFiles: string[]): FeatureCopy[];

// title.ts
export function parseTitle(specMd: string): string | null;

// tasks.ts
export function parseTasks(tasksMd: string): Task[];

// status.ts
export function deriveStatus(input: { hasPlan: boolean; hasTasks: boolean; tasks: Task[]; merged: boolean }): SpecStatus;

// authority.ts
export function pickAuthoritative(
  copies: FeatureCopy[],                              // all copies of one dirName
  rootBranches: Map<string, string | null>,           // root -> checked-out branch
  roots: string[],                                    // ctx.roots order
): FeatureCopy;

// merged.ts
export function mergedMainTasks(root: string, dirName: string): Promise<Task[] | null>; // never throws
export function isMergedIntoMain(root: string, dirName: string): Promise<boolean>; // (await mergedMainTasks(...)) !== null
```

`FeatureCopy` and `Task` shapes are in [data-model.md](../data-model.md).

## detect(ctx)

True when any root has a directory `.specify`, or a `specs/<name>/spec.md` file with `parseFeatureDirName(name) !== null`. Read errors count as "not present". Never throws.

## discover(ctx)

`ctx.roots.map(root => ({ root, patterns: ["specs/*/**"] }))`.

## parse(ctx, files)

1. `groupFeatureFiles(ctx.roots, files)`.
2. `rootBranches`: `currentBranch(root)` for every root (once per scan).
3. Group copies by `dirName`; `pickAuthoritative` per group.
4. For each chosen copy: read `spec.md` (title), `tasks.md` if listed (tasks), check `plan.md` is listed, `mergedMainTasks(copy.root, dirName)`, then `deriveStatus`. When `mergedMainTasks` returns tasks, the spec's `tasks` are those tasks (from `main`), not the copy's.
5. Return specs (mapping in the data model) sorted by `id`, then `dirName`.

A file that cannot be read throws, which the 002 core reports as a failed scan (`stage: "parse"`) and keeps the last good snapshot. (A file deleted between discovery and parse is the usual cause; the next scan recovers.)

## Feature directory names

| Name | Result |
|---|---|
| `003-speckit-adapter` | `{ id: "003", dirName: "003-speckit-adapter" }` |
| `0042-x` | `{ id: "0042", ... }` |
| `12-short` | null (fewer than three digits) |
| `003-` | null (empty name) |
| `notes` | null |

## Title rules

| `spec.md` starts with | `parseTitle` |
|---|---|
| `# Feature Specification: Spec Kit Adapter` | `Spec Kit Adapter` |
| `# feature specification:   Lower Case  ` | `Lower Case` |
| `# No Plan Here` | `No Plan Here` |
| `# Feature Specification:` | null |
| no `# ` line (only `## ...` and text) | null |
| a `# Inside` line only inside a ```` ``` ```` fence, then `# Real` | `Real` |

## Task-line grammar

Processed line by line:

1. A line whose trimmed start is ```` ``` ```` or `~~~` toggles "in fence". Lines while in fence (including the toggling lines) are skipped.
2. `^## +(Phase\b.*?)\s*$` sets the current phase to the captured text. Other headings do not change it.
3. `^\s*[-*] \[([ xX])\] +(T\d+)\b(.*)$` is a task. `done` = box is `x` or `X`.
4. In the rest, read leading tokens that match `\[[^\]]*\]`, separated by whitespace. If any token is exactly `[P]`, `parallel: true` and that token is dropped. Text = remaining tokens joined by one space, then one space, then the remaining description, trimmed (no space is added when either part is empty).
5. Every other line is ignored.

### `fixtures/speckit/tasks-tricky.md` (exact file)

````markdown
# Tasks: Tricky

## Format: `[ID] [P?] [Story] Description`

- [ ] T001 Before any phase
- [ ] Missing an id
- [x] TODO not a task id

## Phase 1: Setup

- [x] T002 [P] Create the thing
- [x] T003 [US1] [P] Marker after story

```text
- [ ] T900 Inside a fence
```

## Notes

* [ ] t901 lower-case id is not a task

## Phase 2: Core

  - [ ] T004 Indented task
- [X] T005 Upper-case X
-[ ] T902 No space after dash
````

Expected `parseTasks` result, in order (`phase`/`parallel` absent where shown as —):

| id | done | parallel | phase | text |
|---|---|---|---|---|
| T001 | false | — | — | `Before any phase` |
| T002 | true | true | `Phase 1: Setup` | `Create the thing` |
| T003 | true | true | `Phase 1: Setup` | `[US1] Marker after story` |
| T004 | false | — | `Phase 2: Core` | `Indented task` |
| T005 | true | — | `Phase 2: Core` | `Upper-case X` |

`## Notes` does not reset the phase, so a task under it would still be in `Phase 1: Setup`.

## Authority rule

| Copies of `003-x` in roots `[A, B]` | Branches | Chosen |
|---|---|---|
| A only | any | A |
| B only | any | B |
| A and B | A: `main`, B: `003-x` | B |
| A and B | A: `003-x`, B: `main` | A |
| A and B | A: `main`, B: null (detached) | A |
| B and C (roots `[A, B, C]`) | none on `003-x` | B |

## Merged rule

`mergedMainTasks(root, dirName)`:

1. `git rev-parse --verify --quiet refs/heads/main^{commit}` fails → null.
2. `git show refs/heads/main:specs/<dirName>/tasks.md` fails → null.
3. `parseTasks(stdout)` is empty → null.
4. Every task done → those tasks; otherwise null.

`isMergedIntoMain(root, dirName)` is `(await mergedMainTasks(root, dirName)) !== null`.

Never throws (all git calls go through `runGit`).
