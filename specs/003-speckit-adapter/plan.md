# Implementation Plan: Spec Kit Adapter

**Branch**: `003-speckit-adapter` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-speckit-adapter/spec.md`

## Summary

Add the first real adapter, `speckit`, under `src/adapters/speckit/`, plus a small read-only git layer under `src/git/` that lists a repo's worktrees and turns a repo path into the `RepoContext.roots` the 002 core already accepts. The adapter detects `.specify/` or `specs/NNN-name/spec.md`, asks to watch `specs/*/**` in every root, and in `parse` groups the matched files by feature directory and root, picks one authoritative copy per feature (the root whose checked-out branch equals the directory name, else the first root in order), reads the title from `spec.md`, parses `tasks.md` line by line (checkbox, `T`-id, `[P]`, phase heading, fenced code skipped), derives the status from which files exist and how many tasks are ticked, and marks a feature `done` when `main`'s own copy of its `tasks.md` has at least one task and all are ticked. All git access goes through one `runGit` helper that spawns `git` with `GIT_OPTIONAL_LOCKS=0` and never writes. Fixtures live in `fixtures/speckit/`; git scenarios (worktrees, merge commit, squash, deleted branch, fresh branch, no `main`) are built in temp repos during tests. `bun run live-check` prints this repo's own specs. No core, server or UI changes.

## Technical Context

**Language/Version**: TypeScript (strict), Bun >= 1.2 (1.4.3 on the dev machine)

**Primary Dependencies**: None new. `Bun.spawn` to run the system `git` (2.54 on the dev machine; any git >= 2.36 prints `prunable` in porcelain output), `node:fs/promises` for reading, hand-written line parsing (no markdown library).

**Storage**: None. Everything is re-read on each scan.

**Testing**: `bun test`. Pure parsers are tested on strings and on `fixtures/speckit/tasks-tricky.md`; the adapter is tested through `scan()` from `src/core/scan.ts` on a temp copy of `fixtures/speckit/repo/`; git scenarios use temp repos built by a new `tests/git-helpers.ts`.

**Target Platform**: Local developer machine (macOS verified). Requires `git` on `PATH` for worktree and `done` support; without it the adapter still works on files alone.

**Project Type**: single project (adds an adapter module and a git helper module)

**Performance Goals**: A scan of 20 features across two worktrees in under 1 s (SC-007). Git calls per scan: one per root (current branch), one for `main`, and one per feature (`git show main:specs/<dir>/tasks.md`), about 25 spawns for 20 features.

**Constraints**: Read-only toward the observed repo and its `.git` (FR-022, Principle III): only `worktree list`, `rev-parse`, `symbolic-ref` and `show` are run, with `GIT_OPTIONAL_LOCKS=0`. Spec Kit knowledge stays out of `src/core/` (FR-023, enforced by the existing `tests/core-agnostic.test.ts`); `src/git/` is framework-agnostic too.

**Scale/Scope**: Tens of features per repo, two or three worktrees. About 7 new source files, 5 new test files, one fixture repo.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Feature branches and PRs only | PASS | Work is on `003-speckit-adapter`; the last task opens a PR. |
| II. Documentation ships with code | PASS | `docs/adapters.md` gains a Spec Kit section; README and `docs/master-spec.md` (merged rule, worktree roots) are explicit tasks (FR-028). |
| III. Read-only observer | PASS | Only read-only git subcommands, `GIT_OPTIONAL_LOCKS=0`; a test hashes every file in every worktree and compares refs and the worktree list before and after a scan. |
| IV. Framework-agnostic through adapters | PASS | Spec Kit layout lives only in `src/adapters/speckit/`. `src/git/` knows git, not Spec Kit. Core is untouched. |
| V. Test-backed and fixture-driven | PASS | Fixtures in `fixtures/speckit/`; git scenarios built from fixture files in temp dirs. The live check reads this repo but is on demand and not part of `bun test`. Each test asserts exact values. |
| VI. Small, explicit tasks | PASS | One pure function per file (title, tasks, status, authority, merged), each with its own test. |
| VII. Commit at every workflow step | PASS | Spec committed (`65d481e`, revised `88a0d30`); this plan is committed before tasks. |
| VIII. Logical, incremental commits | PASS | Tasks are sized for one commit each. |

**Post-design re-check (after Phase 1)**: PASS. No new dependencies. The spec was revised during planning (FR-017: merged means a fully ticked `tasks.md` on `main`, not branch ancestry) because ancestry would mark a freshly created branch as done; see research §4.

## Project Structure

### Documentation (this feature)

```text
specs/003-speckit-adapter/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── speckit-adapter.md   # detect/discover/parse behavior, task-line grammar, status and authority rules
│   ├── git.md               # runGit, listWorktrees, resolveRoots, currentBranch
│   └── live-check.md        # `bun run live-check` command, output and exit codes
└── tasks.md             # Phase 2 output (/speckit-tasks - NOT created here)
```

### Source Code (repository root)

```text
src/
├── git/                          # framework-agnostic, read-only git access
│   ├── run.ts                    # runGit(cwd, args): spawn git with GIT_OPTIONAL_LOCKS=0; never throws
│   └── worktrees.ts              # parseWorktreePorcelain(), listWorktrees(), resolveRoots(), currentBranch()
└── adapters/
    ├── index.ts                  # adapters = [speckitAdapter]
    └── speckit/
        ├── index.ts              # speckitAdapter: detect, discover, parse
        ├── feature-dir.ts        # FEATURE_DIR_RE, parseFeatureDirName(), groupFeatureFiles()
        ├── title.ts              # parseTitle(specMd)
        ├── tasks.ts              # parseTasks(tasksMd)
        ├── status.ts             # deriveStatus(input)
        ├── authority.ts          # pickAuthoritative(copies, rootBranches, roots)
        └── merged.ts             # isMergedIntoMain(root, dirName)

fixtures/speckit/
├── repo/                         # one feature per file-derived status plus edge cases (see data-model)
└── tasks-tricky.md               # parser decoys: fences, format line, id-less boxes, X, indents, [P] after [US1]

scripts/live-check.ts             # bun run live-check [path]

tests/
├── git-helpers.ts                # makeGitRepo(), git(), commitAll(), addWorktree(), snapshotTree()
├── git-worktrees.test.ts         # porcelain parsing, listWorktrees, resolveRoots (subfolder, non-git, missing)
├── speckit-parsers.test.ts       # parseFeatureDirName, parseTitle, parseTasks, deriveStatus, pickAuthoritative
├── speckit-adapter.test.ts       # fixture repo through scan(): every status, fields, ignored dirs, registry
├── speckit-git.test.ts           # merge commit, squash, deleted branch, fresh branch, partial on main, no main, not git
└── speckit-worktrees.test.ts     # authority across worktrees, planner-only spec, detached, missing worktree, read-only

docs/adapters.md                  # + "The Spec Kit adapter" section
```

**Structure Decision**: The adapter gets its own folder because it has several independent pure parsers that each deserve one small file and one focused test. Git access lives in `src/git/` (not `src/core/`, not inside the adapter) because feature 005 will reuse it for the git ingester; it has no Spec Kit knowledge. Nothing in `src/core/`, `src/server/` or `src/cli/` changes; wiring roots and the watcher into the running server stays with feature 006.

## Complexity Tracking

No constitution violations; nothing to justify.
