---

description: "Task list for 003-speckit-adapter"
---

# Tasks: Spec Kit Adapter

**Input**: Design documents from `/specs/003-speckit-adapter/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (speckit-adapter, git, live-check), quickstart.md

**Tests**: Included. The spec requires fixtures and tests (FR-025, FR-026), and the constitution requires tests that fail when the behavior is removed (Principle V): assert exact ids, statuses, task fields, paths and issue kinds. Use `toStrictEqual` (not `toEqual`) wherever a field must be absent, because `toEqual` treats a missing key and `undefined` as equal.

**Organization**: Grouped by user story. User Story 2 (task parsing) comes before User Story 1 because status derivation needs the task parser; both are P1. Complete phases in order; [P] tasks touch different files and can run in parallel.

## Working rules (from the constitution and CLAUDE.md)

- Work only on branch `003-speckit-adapter`. Never commit to `main`.
- One logical commit per task (or tightly related pair), with that task's checkbox ticked in the same commit. Every commit subject ends with `[spec-003]`.
- Do not edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/` or the constitution. If a contract is wrong or ambiguous, stop and report it.
- Nothing may write into an observed repo or its `.git`. Only these git subcommands may appear in `src/`: `rev-parse`, `worktree list --porcelain`, `symbolic-ref`, `show`. Tests that need git build their own repos in temp directories with `tests/git-helpers.ts`; never run git against this repo or `fixtures/` from a test.
- `src/core/` must not change in this feature. `src/git/` must not mention Spec Kit.
- Paths are relative to the repository root. TypeScript strict mode throughout. No new dependencies.
- Run `bun run verify` before ticking any task that changes code.

---

## Phase 1: Setup

- [X] T001 Run `git branch --show-current` (expect `003-speckit-adapter`) and `bun run verify` (expect all 175 existing tests to pass) to confirm a green baseline before any change.

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: Read-only git runner, git test helpers and fixtures.

- [X] T002 [P] Create `src/git/run.ts` exactly as in `contracts/git.md` ("run.ts"): export `interface GitResult { code: number; stdout: string; stderr: string }` and `async function runGit(cwd: string, args: string[]): Promise<GitResult>`. Use `Bun.spawn(["git", "-C", cwd, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" })`, read both streams with `new Response(proc.stdout).text()`, await `proc.exited`. Wrap everything in `try/catch`; on any thrown error resolve `{ code: -1, stdout: "", stderr: <error message> }`. It must never reject.
- [X] T003 [P] Add `export function trackTempDir(dir: string): void` to `tests/helpers.ts` that pushes `dir` onto the existing `created` array (so `cleanupFixtures()` removes it). Then create `tests/git-helpers.ts` exporting:
  - `git(cwd: string, ...args: string[]): Promise<string>`: runs `git -c user.name=test -c user.email=test@example.com -c commit.gpgsign=false -c core.hooksPath=/dev/null <args>` with `cwd` as the working directory via `Bun.spawn`; returns stdout; throws `new Error(\`git ${args.join(" ")} failed: <stderr>\`)` on a non-zero exit (test-only helper, so throwing is fine).
  - `makeGitRepo(fixture?: string, options?: { branch?: string }): Promise<string>`: if `fixture` is given use `copyFixture(fixture)`, otherwise an empty `mkdtemp` dir passed through `realpath` and `trackTempDir`; run `git init -q -b <options.branch ?? "main">`; if a fixture was copied, `commitAll(dir, "fixture")`. Returns the real path.
  - `commitAll(repo: string, message: string): Promise<void>`: `git add -A` then `git commit -q --allow-empty -m <message>`.
  - `addWorktree(repo: string, options: { newBranch?: string; branch?: string; detach?: boolean; from?: string }): Promise<string>`: creates an empty dir with `mkdtemp` + `realpath` + `trackTempDir`, then `<dir>/wt` is the worktree path; runs `git worktree add -q -b <newBranch> <path> <from ?? "main">`, or `git worktree add -q <path> <branch>`, or `git worktree add -q --detach <path> <from ?? "main">`. Returns the worktree path.
  - `snapshotTree(dirs: string[]): Promise<string[]>`: for each dir, every file below it (recursively, skipping any entry named `.git`), one string `<dir>|<relative path>|<sha1 hex of contents>` (use `new Bun.CryptoHasher("sha1")`); return all strings sorted.
  - `gitState(repo: string): Promise<string>`: `git for-each-ref` output followed by `git worktree list --porcelain` output.
- [X] T004 Create `tests/git-run.test.ts`: in a `makeGitRepo()` repo, `runGit(repo, ["rev-parse", "--is-inside-work-tree"])` gives `{ code: 0, stdout: "true\n" }` (check both fields); in a plain `mkdtemp` dir (not git), the same call gives a non-zero `code` and a non-empty `stderr`; with a `cwd` that does not exist it resolves (does not reject) with a non-zero `code`. Use `afterEach(cleanupFixtures)`.
- [X] T005 [P] Create the fixture repo `fixtures/speckit/repo/` with exactly these files (each `spec.md` title line followed by a blank line and one line of text; each `plan.md` is `# Implementation Plan\n`):
  - `.specify/memory/constitution.md`: `# Constitution\n`
  - `specs/README.md`: `Not a feature.\n`
  - `specs/notes/README.md`: `Not a feature either.\n`
  - `specs/001-drafted/spec.md`: `# Feature Specification: Drafted`
  - `specs/002-planned/spec.md` (`# Feature Specification: Planned`), `plan.md`
  - `specs/003-ready/spec.md` (`# Feature Specification: Ready`), `plan.md`, `tasks.md` with three lines `- [ ] T001 One`, `- [ ] T002 Two`, `- [ ] T003 Three`
  - `specs/004-in-progress/spec.md` (`# Feature Specification: In Progress`), `plan.md`, `contracts/api.md` (`# API\n`), `checklists/requirements.md` (`# Checklist\n`), and `tasks.md`:
    ```text
    # Tasks: In Progress

    ## Phase 1: Setup

    - [x] T001 Set up
    - [x] T002 [P] Add config

    ## Phase 2: Build

    - [ ] T003 Build it
    - [ ] T004 [P] Test it
    - [ ] T005 Document it
    ```
  - `specs/005-review/spec.md` (`# Feature Specification: Review`), `plan.md`, `tasks.md` with `- [x] T001 One`, `- [X] T002 Two`, `- [x] T003 Three`
  - `specs/006-empty-tasks/spec.md` (`# Feature Specification: Empty Tasks`), `plan.md`, `tasks.md` containing only `# Tasks\n\n## Phase 1: Setup\n`
  - `specs/007-no-plan/spec.md` (`# No Plan Here`), `tasks.md` with `- [x] T001 Done` and `- [ ] T002 Not done`
  - `specs/008-untitled/spec.md`: `## No top heading\n\nText.\n`
  - `specs/009-no-spec/plan.md`
- [X] T006 [P] Create `fixtures/speckit/tasks-tricky.md` with exactly the content shown in `contracts/speckit-adapter.md` under "`fixtures/speckit/tasks-tricky.md` (exact file)" (the text between the outer four-backtick fence, not including it).

**Checkpoint**: `bun run verify` passes.

---

## Phase 3: User Story 2 - Read the task list in detail (Priority: P1)

**Goal**: `tasks.md` lines become tasks with id, text, done, parallel and phase.

**Independent Test**: `bun test tests/speckit-parsers.test.ts` against `fixtures/speckit/tasks-tricky.md`.

- [X] T007 [US2] Create `src/adapters/speckit/tasks.ts` exporting `parseTasks(tasksMd: string): Task[]` (import `Task` from `src/core/model.ts`), implementing the five rules in `contracts/speckit-adapter.md` "Task-line grammar" exactly: fence toggling on a trimmed line starting with ```` ``` ```` or `~~~` (skip fence lines and everything inside); `^## +(Phase\b.*?)\s*$` sets the current phase (other headings leave it unchanged); task regex `^\s*[-*] \[([ xX])\] +(T\d+)\b(.*)$`; leading `[...]` tokens in the rest, where exactly `[P]` sets `parallel: true` and is dropped and the others are kept; text = kept tokens joined by one space, plus one space, plus the remaining description, trimmed. Add `phase` only when a phase is set and `parallel` only when true (never `parallel: false`). Split input on `\n` and strip a trailing `\r` from each line.
- [X] T008 [US2] Create `tests/speckit-parsers.test.ts` with a `describe("parseTasks")` block: parsing `fixtures/speckit/tasks-tricky.md` gives, with `toStrictEqual`, exactly the five tasks in the contract's expected table (T001 has only `id`, `text`, `done`; T002 and T003 have `parallel: true` and `phase: "Phase 1: Setup"`; T004 and T005 have `phase: "Phase 2: Core"` and no `parallel`); `"## Phase 2: Foundational\n- [x] T003 [P] [US1] Create the config loader"` gives `[{ id: "T003", text: "[US1] Create the config loader", done: true, parallel: true, phase: "Phase 2: Foundational" }]`; `"- [ ] T010 Write the docs"` gives `[{ id: "T010", text: "Write the docs", done: false }]`; `""` gives `[]`; CRLF input `"- [x] T001 A\r\n- [ ] T002 B\r\n"` gives texts `A` and `B`.

**Checkpoint**: parser tests pass. Temporarily remove the fence check in `tasks.ts` and confirm the tricky-file test fails, then restore it.

---

## Phase 4: User Story 1 - See every Spec Kit feature with the right status (Priority: P1) 🎯 MVP

**Goal**: The `speckit` adapter returns one spec per feature directory with id, title, branch, artifacts, tasks and file-derived status.

**Independent Test**: `bun test tests/speckit-adapter.test.ts` on a temp copy of `fixtures/speckit/repo/`.

- [X] T009 [P] [US1] Create `src/adapters/speckit/feature-dir.ts` per `contracts/speckit-adapter.md` and `data-model.md` ("FeatureCopy"): export `FEATURE_DIR_RE = /^(\d{3,})-(.+)$/`, `interface FeatureCopy { root: string; dirName: string; id: string; files: string[] }`, `parseFeatureDirName(name)` (returns `{ id, dirName }` or null), and `groupFeatureFiles(roots: string[], absFiles: string[]): FeatureCopy[]`: map each file to the root it lies under (the longest root `r` such that the file starts with `r + "/"`; files under no root are skipped); take the relative path with `/` separators; keep it only when it is `specs/<dir>/<at least one more segment>` and `parseFeatureDirName(dir)` is not null; group by `(root, dir)`; drop groups that do not contain `specs/<dir>/spec.md`; sort each group's `files`; return groups ordered by the root's index in `roots`, then by `dirName`.
- [X] T010 [P] [US1] Create `src/adapters/speckit/title.ts` exporting `parseTitle(specMd: string): string | null` per `contracts/speckit-adapter.md` "Title rules": the first line outside a code fence (same fence rule as T007) matching `^# +(.*)$`; remove a leading `Feature Specification:` case-insensitively; trim; return null if empty or if there is no such line.
- [X] T011 [P] [US1] Create `src/adapters/speckit/status.ts` exporting `interface StatusInput { hasPlan: boolean; hasTasks: boolean; tasks: Task[]; merged: boolean }` and `deriveStatus(input: StatusInput): SpecStatus` implementing the six-row table in `data-model.md` "Status derivation" in that exact order (first match wins).
- [X] T012 [US1] Extend `tests/speckit-parsers.test.ts` with: a `parseFeatureDirName` test covering every row of the contract's "Feature directory names" table; `groupFeatureFiles` tests: two roots `/a` and `/b` each with `specs/003-x/spec.md` give two copies in root order; roots `/r` and `/r/.wt/x` with file `/r/.wt/x/specs/001-y/spec.md` give one copy with root `/r/.wt/x`; `/a/specs/README.md`, `/a/specs/notes/x.md` and `/a/specs/009-z/plan.md` (no spec.md) give nothing; a copy's `files` are sorted and relative (`specs/004-a/contracts/api.md` before `specs/004-a/spec.md`); a `parseTitle` test for every row of the "Title rules" table; and a `deriveStatus` test for each of the six rows plus precedence cases: `{ merged: true, hasTasks: false, hasPlan: false, tasks: [] }` is `done`; `{ hasTasks: true, tasks: [], hasPlan: false, merged: false }` is `ready`; all tasks done but `merged: false` is `review`.
- [X] T013 [US1] Create `src/adapters/speckit/index.ts` exporting `speckitAdapter: Adapter` with `name: "speckit"`:
  - `detect(ctx)` per the contract: for each root, true if `<root>/.specify` is a directory, or if `<root>/specs` has an entry whose name passes `parseFeatureDirName` and which contains a file `spec.md`. Catch every filesystem error and treat it as "not present". Never throws.
  - `discover(ctx)`: `ctx.roots.map((root) => ({ root, patterns: ["specs/*/**"] }))`.
  - `parse(ctx, files)`: `groupFeatureFiles(ctx.roots, files)`; for each `dirName` keep the first copy in root order (T020 replaces this with the authority rule); for each kept copy read `specs/<dirName>/spec.md` and, if listed in `files`, `tasks.md` with `Bun.file(path.join(root, rel)).text()`; `hasPlan` = `files` includes `specs/<dirName>/plan.md`; `merged: false` for now (T023 adds the git check); build the spec `{ id, title, status, dependsOn: [], tasks, artifacts: copy.files, branch: dirName, source: { root } }`, leaving out `title` when `parseTitle` returns null; return specs sorted by `id`, then `dirName`. Do not catch file-read errors in `parse` (the core turns them into a failed scan).
- [X] T014 [US1] In `src/adapters/index.ts`, import `speckitAdapter` from `./speckit` and set `export const adapters: Adapter[] = [speckitAdapter];`. Replace the "Feature 003 adds the first adapter" comment with `// Registration order breaks detection ties.`
- [X] T015 [US1] Create `tests/speckit-adapter.test.ts`, each test on `copyFixture("speckit/repo")` (not a git repo), with `afterEach(cleanupFixtures)`, running `scan(speckitAdapter, { roots: [dir] })` from `src/core/scan.ts`:
  - `ok` is true and spec ids are exactly `["001","002","003","004","005","006","007","008"]`.
  - Statuses: 001 `drafted`, 002 `planned`, 003 `ready`, 004 `in-progress`, 005 `review`, 006 `ready`, 007 `in-progress`, 008 `drafted` (none `done`, since this copy is not a git repo).
  - Spec 004 with `toStrictEqual`: `{ id: "004", title: "In Progress", status: "in-progress", dependsOn: [], tasks: <the five tasks from the T005 tasks.md, with phases "Phase 1: Setup"/"Phase 2: Build" and parallel on T002 and T004>, artifacts: ["specs/004-in-progress/checklists/requirements.md", "specs/004-in-progress/contracts/api.md", "specs/004-in-progress/plan.md", "specs/004-in-progress/spec.md", "specs/004-in-progress/tasks.md"], branch: "004-in-progress", source: { root: dir } }` (no `source.branch`).
  - 007 has title `No Plan Here`; 008 has title `008` and the snapshot has an issue with `kind: "missing-title"` and `specId: "008"`.
  - Adding `specs/007-b/spec.md` (`# Feature Specification: B`) to the copy gives an issue `kind: "duplicate-id"` for `007`.
  - Deleting `specs/005-review/plan.md` from the copy leaves 005 as `review` (tasks without plan).
  - `detect`: true for the fixture copy; true for a temp dir containing only `.specify/`; false for an empty temp dir; false for a temp dir with only `specs/12-x/spec.md`; false for a temp dir with only `specs/003-x/plan.md`.
  - `discover({ roots: [dir] })` equals `[{ root: dir, patterns: ["specs/*/**"] }]`.
  - `selectAdapter(createRegistry(adapters), { roots: [dir] })` (from `src/core/registry.ts` and `src/adapters/index.ts`) selects the adapter named `speckit`, and `assertKnownAdapter("speckit", createRegistry(adapters))` does not throw.

**Checkpoint**: MVP. `bun run verify` passes, including the existing `tests/core-agnostic.test.ts`.

---

## Phase 5: User Story 3 - One picture across planner and coder worktrees (Priority: P1)

**Goal**: Every worktree is a root; one spec per feature, from the worktree that has its branch checked out.

**Independent Test**: `bun test tests/git-worktrees.test.ts tests/speckit-worktrees.test.ts`.

- [X] T016 [US3] Create `src/git/worktrees.ts` per `contracts/git.md` "worktrees.ts": export `interface Worktree { path: string; branch: string | null; bare: boolean; prunable: boolean }`, `parseWorktreePorcelain(text)` (block rules in the contract), `listWorktrees(cwd)` (`runGit(cwd, ["worktree", "list", "--porcelain"])`; non-zero code gives `[]`), `currentBranch(cwd)` (`runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])`; code 0 gives trimmed stdout, otherwise null) and `resolveRoots(repoPath)` (steps 1-3 in the contract, without duplicates). Import only from `./run`.
- [X] T017 [US3] Create `tests/git-worktrees.test.ts`: `parseWorktreePorcelain` of the contract's example text gives exactly the contract's three entries (`toStrictEqual`); a block `worktree /bare\nbare\n` gives `{ path: "/bare", branch: null, bare: true, prunable: false }`; a block without a `worktree` line is skipped. With temp repos from `tests/git-helpers.ts`, check every row of the `resolveRoots` table in the contract: plain temp dir → `[dir]`; repo with one `addWorktree({ newBranch: "003-x" })` → `[repo, wt]`; called with `wt` → `[wt, repo]`; called with `<repo>/sub` (create the folder) → `[repo, wt]`; repo with a detached worktree whose folder was then removed with `rm(..., { recursive: true })` → `[repo, removedPath]`. Also `currentBranch(wt)` is `"003-x"` and `currentBranch` of a detached worktree is null, and `currentBranch` of a plain dir is null.
- [ ] T018 [P] [US3] Create `src/adapters/speckit/authority.ts` exporting `pickAuthoritative(copies: FeatureCopy[], rootBranches: Map<string, string | null>, roots: string[]): FeatureCopy`: among `copies` (all with the same `dirName`, at least one), return the one whose root's branch equals `dirName`, choosing the lowest root index if several; otherwise the copy with the lowest root index in `roots`.
- [ ] T019 [US3] Extend `tests/speckit-parsers.test.ts` with a `pickAuthoritative` test for every row of the contract's "Authority rule" table (build `FeatureCopy` objects by hand; roots `/A`, `/B`, `/C`).
- [ ] T020 [US3] Update `parse` in `src/adapters/speckit/index.ts`: first compute `rootBranches` with `currentBranch(root)` for every `ctx.roots` entry (one call per root per scan); group copies by `dirName` and choose with `pickAuthoritative`; set `source` to `{ root }` plus `branch` when `rootBranches.get(root)` is not null. Re-run `tests/speckit-adapter.test.ts` (still passes: not a git repo, so no `source.branch`).
- [ ] T021 [US3] Create `tests/speckit-worktrees.test.ts` with `afterEach(cleanupFixtures)`. Setup per test: `repo = makeGitRepo("speckit/repo")` (branch `main`, fixture committed). Do not assert the status of 005 in this file (US4 makes it `done`). Cases:
  - Planner-only spec and checked-out branch wins: `b = addWorktree(repo, { newBranch: "004-in-progress" })`; in `b`, rewrite `specs/004-in-progress/tasks.md` with all five boxes ticked and add `specs/010-planner-only/spec.md` (`# Feature Specification: Planner Only`). `roots = resolveRoots(repo)`; `scan(speckitAdapter, { roots })`: exactly one spec `004`, status `review`, `source` `{ root: b, branch: "004-in-progress" }`; spec `010` exists with title `Planner Only` and `source.root === b`; no `duplicate-id` issue.
  - Starting from the other worktree: `resolveRoots(b)` gives `b` first and the same specs come back.
  - No copy on its branch: `c = addWorktree(repo, { detach: true })`; in `c`, tick `T001` in `specs/003-ready/tasks.md`. Scanning from `repo` gives 003 `ready` with `source.root === repo` and `source.branch === "main"`; scanning from `c` (`resolveRoots(c)`) gives 003 `in-progress` with `source.root === c` and no `source.branch`.
  - Missing worktree: `d = addWorktree(repo, { detach: true })`, then delete the folder `d`. Scanning from `repo` returns `ok: true`, an issue with `kind: "unreadable-path"` whose `message` contains `d`, and specs `001`-`008` still present.
  - Single worktree: `resolveRoots(repo)` is `[repo]` and 003 has `source` `{ root: repo, branch: "main" }`.
  - Read-only: with worktrees `b` and `c` set up as above, take `snapshotTree([repo, b, c])` and `gitState(repo)`, run `resolveRoots` and `scan` twice, take both again, and assert they are equal.
  - Speed (SC-007): in a repo with worktree `b`, create 20 feature dirs `specs/1NN-f/` (`100`-`119`, each with `spec.md`, `plan.md` and a 3-task `tasks.md`), 10 in `repo` and 10 in `b`; `scan` (after `resolveRoots`) completes in under 1000 ms measured with `performance.now()`.

**Checkpoint**: `bun run verify` passes. Temporarily make `pickAuthoritative` always return `copies[0]` and confirm the first case fails, then restore it.

---

## Phase 6: User Story 4 - Merged features show as done (Priority: P2)

**Goal**: A feature whose fully ticked `tasks.md` is on `main` is `done`, however it was merged.

**Independent Test**: `bun test tests/speckit-git.test.ts`.

- [ ] T022 [US4] Create `src/adapters/speckit/merged.ts` exporting `isMergedIntoMain(root: string, dirName: string): Promise<boolean>` following the four steps in `contracts/speckit-adapter.md` "Merged rule" exactly, using `runGit` from `src/git/run.ts`: `["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"]`, then `["show", \`refs/heads/main:specs/${dirName}/tasks.md\`]`, then `parseTasks(stdout)`. Any non-zero code gives false. Never throws.
- [ ] T023 [US4] In `parse` in `src/adapters/speckit/index.ts`, replace `merged: false` with `await isMergedIntoMain(copy.root, dirName)` for each chosen copy.
- [ ] T024 [US4] Create `tests/speckit-git.test.ts` with `afterEach(cleanupFixtures)`, each case scanning with `scan(speckitAdapter, { roots: await resolveRoots(repo) })`. Helper in the file: `addFeature(dir, name, ticked: boolean)` writes `specs/<name>/spec.md`, `plan.md` and a `tasks.md` with `- [x]`/`- [ ] T001 One` and `T002 Two`. Cases, each starting from `repo = makeGitRepo("speckit/repo")`:
  - Fixture on `main`: 005 is `done` (all ticked on `main`), 004 is `in-progress` and 003 is `ready` (partial and unticked on `main`), 001 is `drafted`.
  - Merge commit: `git switch -c 011-merged`, `addFeature(repo, "011-merged", true)`, `commitAll`, `git switch main`, `git merge --no-ff -q -m merge 011-merged` → 011 is `done`. Then `git branch -D 011-merged` → 011 still `done`.
  - Squash: `git switch -c 012-squashed`, `addFeature(..., true)`, commit, `git switch main`, `git merge --squash 012-squashed`, `commitAll(repo, "squash")`. Assert `runGit(repo, ["merge-base", "--is-ancestor", "012-squashed", "main"])` has `code` 1 (not an ancestor), and 012 is `done`.
  - Unmerged, fully ticked: `git switch -c 013-review`, `addFeature(..., true)`, commit (stay on the branch) → 013 is `review`.
  - Fresh branch: `git switch -c 014-fresh`, write only `specs/014-fresh/spec.md`, do not commit → 014 is `drafted`.
  - Spec-only merge: `git switch -c 015-early`, `addFeature(..., false)`, commit, `git switch main`, `git merge --no-ff -q -m merge 015-early` → 015 is `ready`, not `done`.
  - No `main`: `makeGitRepo("speckit/repo", { branch: "trunk" })` → 005 is `review` and no spec is `done`.
  - Not git: `copyFixture("speckit/repo")` → no spec is `done`, 005 is `review`.

**Checkpoint**: `bun run verify` passes. Temporarily make `isMergedIntoMain` always return false and confirm the merge and squash cases fail, then restore it.

---

## Phase 7: User Story 5 - Dogfood: the visualizer reads its own specs (Priority: P3)

**Goal**: An on-demand live check of this repo.

**Independent Test**: `bun run live-check` output matches `quickstart.md` section 2.

- [ ] T025 [US5] Create `scripts/live-check.ts` per `contracts/live-check.md`: optional first argument (default `path.resolve(import.meta.dir, "..")`), `resolveRoots`, `currentBranch` per root, `scan(speckitAdapter, { roots })`. On success print one `root  <path>  (<branch or "detached">)` line per root, one `<id>  <status padded to 11>  <title>  [<source.root>[, <source.branch>]]` line per spec and one `issue  <kind>  <message>` line per issue, then exit 0. On `ok: false` print `Scan failed (<stage>): <message>` to stderr and exit 1. Add `"live-check": "bun scripts/live-check.ts"` to `scripts` in `package.json`.
- [ ] T026 [US5] Run `git status --short` (expect empty), `bun run live-check`, then `git status --short` again (expect empty). Confirm `001  done` "Server Skeleton" and `002  done` "Common Spec Model and Adapter Contract" appear, plus `003` with its current status. Paste the output in your reply (do not save it to a file). If 001 or 002 is not `done`, stop and report.

---

## Phase 8: Polish, Documentation and PR

- [ ] T027 [P] Update `docs/adapters.md`: add a section "The Spec Kit adapter" covering detection (`.specify/` or `specs/NNN-name/spec.md`); id, title, branch and artifacts; the task-line grammar (checkbox, `T`-id, `[P]`, phase headings, fenced code ignored); the status table; the merged rule (fully ticked `tasks.md` on local `main`; pull `main` after merging on GitHub); worktree roots (`resolveRoots`, the path given first, missing worktrees reported as `unreadable-path`) and the authority rule; read-only git use (`src/git/`, `GIT_OPTIONAL_LOCKS=0`); and `bun run live-check`. Mention `fixtures/speckit/` as a second worked example next to `fixtures/stub/`.
- [ ] T028 [P] Update `README.md`: rewrite the opening status paragraph to say the Spec Kit adapter now reads specs from every worktree (spec `003-speckit-adapter`) and that the board and timeline come later; in "Spec adapters", replace "No adapter ships yet" with a sentence naming `speckit`; add `bun run live-check` to the scripts list; add `src/git/` (read-only git access) and `src/adapters/speckit/` to the project structure, and mention `fixtures/speckit/` in the `fixtures/` line.
- [ ] T029 [P] Update `docs/master-spec.md`: in the Spec Kit status-derivation bullet replace "branch merged → done" with "fully ticked tasks.md on main → done (covers merge, squash and deleted branches)"; add Decisions rows "Git access | Read-only `git` subprocesses (`rev-parse`, `worktree list --porcelain`, `symbolic-ref`, `show`) with `GIT_OPTIONAL_LOCKS=0`, in `src/git/`" and "Spec Kit worktree copies | The copy in the worktree that has the feature branch checked out wins; otherwise the path the user gave, then git's worktree order".
- [ ] T030 Walk through every section of `specs/003-speckit-adapter/quickstart.md` for real (section 3 is optional; if you run it, remove the demo worktree and branch afterwards). Fix the code or report any mismatch (do not edit the quickstart).
- [ ] T031 Run `bun run verify` three times in a row and `bun run build`; all must pass. Fix failures before continuing.
- [ ] T032 Confirm `git status` is clean (no temp files, no `node_modules`, no `dist`), every task above is ticked, and all work is committed with `[spec-003]`.
- [ ] T033 Push `003-speckit-adapter` and open a pull request to `main` with `gh pr create`. Description: summary of the spec, link to `specs/003-speckit-adapter/`, documentation updated (T027-T029), the live-check output from T026, results of T030-T031, and anything not verified. End the description with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge it; the maintainer reviews and merges.

---

## Dependencies & Execution Order

- Phase 1 → Phase 2. In Phase 2, T002, T003, T005 and T006 are independent; T004 needs T002 and T003.
- US2 (Phase 3) needs T006. US1 (Phase 4) needs US2 (`parseTasks`) and T005. US3 (Phase 5) needs US1 (`index.ts`, `feature-dir.ts`) and T002-T003. US4 (Phase 6) needs US1 and T002; it can run before or after US3, but run it after US3 so T021's rule of not asserting 005 stays meaningful. US5 (Phase 7) needs US3 and US4 (it uses `resolveRoots`, and 001/002 are only `done` with the merged rule).
- Recommended order: Setup → Foundational → US2 → US1 → US3 → US4 → US5 → Polish.

### Parallel opportunities

- Foundational: T002, T003, T005, T006.
- US1: T009, T010 and T011 (three separate files), then T012-T015 in order.
- US3: T018 alongside T016-T017.
- Polish: T027, T028 and T029.

## Implementation Strategy

1. Phases 1-4 give the MVP: the adapter reads a single checkout and derives every file-based status. Stop and run `bun run verify`.
2. Add US3 (worktrees), then US4 (merged → done), running `bun run verify` after each phase and doing each checkpoint's "make it fail" check.
3. US5 proves it on this repo. Finish with Phase 8; the documentation tasks are required, not optional.
