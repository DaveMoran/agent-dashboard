# Research: Spec Kit Adapter

No `NEEDS CLARIFICATION` items remained after the spec. The decisions below settle the open design questions. Git behavior was checked on the dev machine (git 2.54, macOS) in a scratch repo.

## 1. How to run git

- **Decision**: One helper, `runGit(cwd, args)` in `src/git/run.ts`, using `Bun.spawn(["git", "-C", cwd, ...args])` with `env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }`, `stdin: "ignore"`, capturing stdout and stderr. It returns `{ code, stdout, stderr }` and never throws: a missing `git` binary or any spawn error returns `{ code: -1, stdout: "", stderr: <message> }`.
- **Rationale**: Read-only is non-negotiable (Principle III). `GIT_OPTIONAL_LOCKS=0` stops git from taking optional locks or refreshing the index as a side effect. A never-throwing helper means "not a git repo" and "git not installed" are both just "no git info", which FR-018 requires. Only these subcommands are used: `rev-parse`, `worktree list --porcelain`, `symbolic-ref`, `show`.
- **Alternatives**: Reading `.git/HEAD`, `.git/worktrees/*` and packed refs by hand (fragile: packed refs, `gitdir:` files, `commondir`); a git library such as isomorphic-git (a dependency, and slower to keep correct across worktrees).

## 2. Listing worktrees and building roots

- **Decision**: `listWorktrees(cwd)` runs `git worktree list --porcelain` and parses blank-line-separated blocks: `worktree <path>`, `branch refs/heads/<name>` (branch = `<name>`), `detached` (branch = null), `bare`, `prunable <reason>`. `resolveRoots(repoPath)` runs `git rev-parse --show-toplevel` in `repoPath`; if that fails, the result is `[repoPath]`. Otherwise roots are the top level first, then every non-bare worktree in listing order, skipping the one equal to the top level. Prunable (missing) worktrees are kept in the list, using the path git prints.
- **Rationale**: This is the method feature 005 describes, so 005 can import it. Starting from the top level makes a subfolder path work (spec edge case) and keeps "the path the user gave" first. Keeping missing worktrees in `roots` lets the existing 002 scan report them as `unreadable-path` (its walk already turns an unreadable root into that issue and continues), which is exactly FR-021, with no new issue kind and no core change.
- **Verified**: porcelain output for a detached worktree contains `detached`; a worktree whose folder was deleted shows `prunable gitdir file points to non-existent location`; `rev-parse --show-toplevel` from a subfolder prints the worktree's top level.
- **Alternatives**: Dropping missing worktrees silently (violates FR-021); adding a new issue kind (core change for no gain).

## 3. Knowing each root's branch inside the adapter

- **Decision**: The adapter calls `currentBranch(root)` (`git symbolic-ref --quiet --short HEAD`; exit 0 gives the branch, anything else gives null) once per root at the start of `parse`, and records it in `source.branch`.
- **Rationale**: The 002 contract gives adapters only `roots`. Asking git per root keeps the contract unchanged and works the same in tests and live. One spawn per root is cheap.
- **Alternatives**: Extending `RepoContext` with branches (changes the 002 contract and core); calling `listWorktrees` from the adapter and matching paths (works, but path normalization between git output and real paths is a source of bugs; per-root `symbolic-ref` avoids it).

## 4. When a feature counts as merged (spec revised during planning)

- **Decision**: A feature is `done` exactly when `git show refs/heads/main:specs/<dir>/tasks.md` (run in the authoritative root) succeeds, its content parses to at least one task, and every task is done. If `refs/heads/main` does not exist, or `git show` fails for any reason, the feature is not done. FR-017 and User Story 4 were updated to match.
- **Rationale**: This project squash-merges pull requests: `002-common-model-adapter-interface` is not an ancestor of `main` (checked with `git merge-base --is-ancestor`), yet `main` holds its fully ticked `tasks.md`. The first draft also allowed "branch tip contained in `main`", but a branch just created from `main` (the planner's state right after `/speckit-specify`, before committing) is trivially contained in `main` and would show as `done`. Using only `main`'s task list covers merge commits, squash merges and deleted branches with one rule and no false positive. Live check on this repo: `001` (43/43 ticked on `main`) and `002` (35/35) are `done`.
- **Alternatives**: Ancestry only (fails for squash merges); ancestry or tasks-on-main (fresh-branch false positive); a `[spec-NNN]` commit on `main` (spec-only PRs carry the tag too); checking `origin/main` (not in the spec; local `main` must be pulled after a GitHub merge, documented in the adapter guide).

## 5. Choosing among worktree copies

- **Decision**: For each directory name, collect the copies (root, files) that contain `spec.md`. If a copy's root has `currentBranch(root) === dirName`, it wins. If several roots have it checked out (impossible in git, but defensively), the first in root order wins. Otherwise the first copy in root order wins.
- **Rationale**: FR-019 as written. Root order is `resolveRoots` order, so the path the user gave is preferred, then git's listing order. Deterministic and easy to test as a pure function (`pickAuthoritative`).
- **Alternatives**: Most-advanced copy wins (a stale copy with more ticks could hide a reset); newest mtime (non-deterministic across checkouts).

## 6. What to watch and how to group files

- **Decision**: `discover` returns, for every root, `["specs/*/**"]`. `parse` maps each absolute file to the root that contains it (the longest root prefix followed by `/`), takes the relative path, keeps only `specs/<dir>/<rest>` where `<dir>` matches `^(\d{3,})-(.+)$`, and groups by `(root, dir)`. A group without `spec.md` produces nothing.
- **Rationale**: Verified that `Bun.Glob("specs/*/**")` matches `specs/001-x/spec.md` and `specs/001-x/contracts/a.md` but not `specs/README.md`. Watching the whole feature directory makes new artifacts (contracts, checklists) appear in `artifacts` and makes `plan.md`/`tasks.md` creation trigger a rescan. Longest-prefix matching handles a worktree nested inside another (for example `repo/` and `repo/.worktrees/x`).
- **Alternatives**: Separate patterns per file name (misses artifacts in subfolders).

## 7. Detection

- **Decision**: `detect` is true when any root has a `.specify` directory, or a `specs/` directory containing an entry that matches the feature-dir pattern and has a `spec.md` file. It reads directories with `readdir`/`stat` only and treats any read error as "not here".
- **Rationale**: FR-001. A fresh `specify init` repo with no features yet should still select this adapter (spec edge case).

## 8. Parsing task lines

- **Decision**: A line-by-line scanner. A line starting (after up to any indentation) with three or more backticks or tildes toggles "in fence"; lines in a fence are ignored. `^## +(Phase\b.*?)\s*$` sets the current phase. A task matches `^\s*[-*] \[([ xX])\] +(T\d+)\b(.*)$`. In the rest, leading bracketed markers (`\[[^\]]*\]` separated by spaces) are scanned; a marker exactly `[P]` sets `parallel: true` and is removed; others stay. Text is the remaining string, inner runs of spaces left as written, trimmed at both ends.
- **Rationale**: Matches the Spec Kit tasks template (`- [ ] T001 [P] [US1] Description`) and the decoys in this repo's own task lists (`## Format: \`[ID] [P?] [Story] Description\``, code blocks in examples). `[P?]` is not `[P]`, so the format line can never set parallel even if it were a task.
- **Alternatives**: A markdown parser library (dependency; line rules are simpler and exact).

## 9. Title

- **Decision**: The first line outside a code fence matching `^# +(.*)$`. Strip a leading `Feature Specification:` (case-insensitive) and trim. An empty result means no title is returned, so core validation reports `missing-title` and uses the id.
- **Rationale**: FR-006 and the spec edge cases. Both of this repo's specs start with `# Feature Specification: <Title>`.

## 10. Fixtures and git test repos

- **Decision**: `fixtures/speckit/repo/` is a plain folder (no `.git`). `tests/git-helpers.ts` provides `makeGitRepo(fixtureName?)` (temp dir, `git init -b main`, copy fixture, commit), `git(cwd, ...args)` (runs with `-c user.name=test -c user.email=test@example.com -c commit.gpgsign=false -c core.hooksPath=/dev/null` so the developer's hooks and signing never run) and `snapshotTree(dirs)` (sorted list of relative path + SHA-1 of every file, skipping `.git/`), plus `gitState(repo)` (`for-each-ref` and `worktree list --porcelain` output) for the read-only test. These helpers write only inside their own temp dirs.
- **Rationale**: A committed fixture cannot contain its own `.git`. Building repos at test time keeps every git scenario reproducible and keeps tests away from this repo (Principle V).

## 11. Live check

- **Decision**: `scripts/live-check.ts`, run with `bun run live-check [path]` (default: the repo the script lives in). It calls `resolveRoots`, then `scan(speckitAdapter, { roots })`, and prints one line per spec (`id  status  title  [root, branch]`) and one line per issue. Exit 0 when the scan succeeds, 1 when it fails. It asserts nothing about specific specs.
- **Rationale**: FR-027 wants an on-demand check against real state, outside the fixture-based suite (Principle V). Hard-coding expected statuses would break every time a spec moves; the quickstart lists what to expect today.
