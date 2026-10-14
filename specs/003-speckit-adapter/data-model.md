# Data Model: Spec Kit Adapter

The output shape is the 002 common model (`src/core/model.ts`, [002 data-model](../002-common-model-adapter-interface/data-model.md)). This file defines the adapter's internal values and how each maps onto `Spec`.

## Internal values

### Worktree (`src/git/worktrees.ts`)

| Field | Type | Notes |
|---|---|---|
| `path` | string | As printed after `worktree ` in porcelain output. |
| `branch` | string \| null | `<name>` from `branch refs/heads/<name>`; null when `detached` or no branch line. |
| `bare` | boolean | True when the block has a `bare` line. Bare entries never become roots. |
| `prunable` | boolean | True when the block has a `prunable` line (folder missing). Still becomes a root. |

### FeatureCopy (`src/adapters/speckit/feature-dir.ts`)

One feature directory in one root.

| Field | Type | Notes |
|---|---|---|
| `root` | string | The `ctx.roots` entry containing the files. |
| `dirName` | string | For example `003-speckit-adapter`. Matches `^(\d{3,})-(.+)$`. |
| `id` | string | The digits, as written (`003`, `0042`). |
| `files` | string[] | Paths relative to `root`, `/`-separated, sorted. Always includes `specs/<dirName>/spec.md`. |

`groupFeatureFiles(roots, absFiles)` returns `FeatureCopy[]` in root order, then `dirName` order. Groups without `spec.md` are dropped.

### ParsedTask (`src/adapters/speckit/tasks.ts`)

Same as the core `Task`: `id`, `text`, `done`, and `phase` / `parallel` only when set (`parallel` is `true` or absent, never `false`).

### StatusInput (`src/adapters/speckit/status.ts`)

| Field | Type |
|---|---|
| `hasPlan` | boolean |
| `hasTasks` | boolean (a `tasks.md` file exists) |
| `tasks` | ParsedTask[] |
| `merged` | boolean |

## Status derivation (FR-016)

`deriveStatus(input)`, first matching row wins:

| # | Condition | Status |
|---|---|---|
| 1 | `merged` | `done` |
| 2 | `hasTasks` and `tasks.length > 0` and every task done | `review` |
| 3 | `hasTasks` and at least one task done | `in-progress` |
| 4 | `hasTasks` | `ready` |
| 5 | `hasPlan` | `planned` |
| 6 | otherwise | `drafted` |

`merged` comes from `isMergedIntoMain(root, dirName)`: true exactly when `refs/heads/main` resolves and `git show refs/heads/main:specs/<dirName>/tasks.md` succeeds and `parseTasks` of its output gives at least one task, all done.

## Mapping to `Spec`

| Spec field | Value |
|---|---|
| `id` | `FeatureCopy.id` |
| `title` | `parseTitle(spec.md)`; omitted when null |
| `status` | `deriveStatus(...)` |
| `dependsOn` | `[]` |
| `tasks` | `parseTasks(tasks.md)`, or `[]` without `tasks.md` |
| `artifacts` | `FeatureCopy.files` |
| `branch` | `FeatureCopy.dirName` |
| `source` | `{ root, branch }` with `branch` = `currentBranch(root)`; `branch` omitted when null |

Specs are returned sorted by `id`, then `dirName`. Two directories with the same number (`007-a`, `007-b`) both produce id `007`; the core reports `duplicate-id` and keeps the first.

## Fixture repo: `fixtures/speckit/repo/`

| Directory | Files | Expected status | Purpose |
|---|---|---|---|
| `.specify/memory/constitution.md` | one line | n/a | Detection without features |
| `specs/001-drafted/` | `spec.md` | `drafted` | Title `Drafted` |
| `specs/002-planned/` | `spec.md`, `plan.md` | `planned` | |
| `specs/003-ready/` | `spec.md`, `plan.md`, `tasks.md` (3 unticked) | `ready` | |
| `specs/004-in-progress/` | `spec.md`, `plan.md`, `tasks.md` (2 of 5 ticked, two phases, one `[P]`), `contracts/api.md`, `checklists/requirements.md` | `in-progress` | Artifacts in subfolders, phases |
| `specs/005-review/` | `spec.md`, `plan.md`, `tasks.md` (all ticked, one with `X`) | `review` | |
| `specs/006-empty-tasks/` | `spec.md`, `plan.md`, `tasks.md` (headings only) | `ready` | Zero tasks |
| `specs/007-no-plan/` | `spec.md`, `tasks.md` (1 of 2 ticked) | `in-progress` | Tasks without plan |
| `specs/008-untitled/` | `spec.md` with no `# ` heading | `drafted` | `missing-title` issue, title = `008` |
| `specs/009-no-spec/` | `plan.md` only | (none) | Ignored |
| `specs/notes/` | `README.md` | (none) | Non-matching name ignored |
| `specs/README.md` | text | (none) | Not inside a feature dir |

Titles: every `spec.md` except 008 starts with `# Feature Specification: <Name>`, where `<Name>` is the directory's words title-cased (`004-in-progress` → `In Progress`), except `007-no-plan/spec.md`, which starts with `# No Plan Here` (no prefix, used as written).

## Fixture: `fixtures/speckit/tasks-tricky.md`

Exactly these lines produce tasks (all other lines are decoys); see the contract for the full file and expected output:

| id | done | parallel | phase | text |
|---|---|---|---|---|
| `T001` | false | — | — | `Before any phase` |
| `T002` | true | true | `Phase 1: Setup` | `Create the thing` |
| `T003` | true | true | `Phase 1: Setup` | `[US1] Marker after story` |
| `T004` | false | — | `Phase 2: Core` | `Indented task` |
| `T005` | true | — | `Phase 2: Core` | `Upper-case X` |
