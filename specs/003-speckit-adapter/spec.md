# Feature Specification: Spec Kit Adapter

**Feature Branch**: `003-speckit-adapter`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Implement the Spec Kit adapter. Detect `specs/NNN-feature/` directories. Derive status: only spec.md -> drafted; plus plan.md -> planned; plus tasks.md -> ready; some tasks checked -> in-progress; all checked -> review; feature branch merged into main -> done. Parse tasks.md checkboxes, task IDs, `[P]` parallel markers and phase headings. Take the title from spec.md. Use the `NNN-feature` branch name as `branch`. Add fixtures under `fixtures/speckit/` covering each status, and use this repo's own `specs/` as a live check. The planner and coder may work in different git worktrees of the same repo, so discover specs in every worktree (see 005 for how to list them): the same `NNN-feature` directory may exist in several worktrees, and the copy in the worktree whose checked-out branch is that feature's branch is authoritative. A spec that exists only in the planner's worktree (not yet merged) must still appear on the board."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See every Spec Kit feature with the right status (Priority: P1)

A developer points Agent Visualizer at a repo that uses Spec Kit. Every feature directory under `specs/` (named `NNN-feature-name`) becomes one spec in the picture, with its number as the id, the title from its specification, its directory name as its branch, and a status that matches how far the feature has got: specification only, planned, tasks written, tasks under way, or all tasks ticked.

**Why this priority**: This is the first real adapter and the reason features 001 and 002 exist. Without it the board has nothing to show.

**Independent Test**: Run the adapter against the `fixtures/speckit/` fixture repo (one feature per status) and check that each feature comes back with the expected id, title, branch and status.

**Acceptance Scenarios**:

1. **Given** a feature directory containing only a specification, **When** the repo is scanned, **Then** the spec's status is `drafted`.
2. **Given** a feature directory with a specification and a plan, **When** the repo is scanned, **Then** the status is `planned`.
3. **Given** a feature directory with a specification, a plan and a task list in which no task is ticked, **When** the repo is scanned, **Then** the status is `ready`.
4. **Given** a task list in which some but not all tasks are ticked, **When** the repo is scanned, **Then** the status is `in-progress`.
5. **Given** a task list in which every task is ticked, and the feature is not yet merged, **When** the repo is scanned, **Then** the status is `review`.
6. **Given** a feature directory named `004-transcript-ingester` whose specification starts with the heading `# Feature Specification: Transcript Ingester`, **When** it is scanned, **Then** the spec has id `004`, title `Transcript Ingester` and branch `004-transcript-ingester`.
7. **Given** a repo with a `specs/` folder containing a directory that does not follow the `NNN-name` pattern, or a feature directory without a specification, **When** it is scanned, **Then** that directory produces no spec and the others are unaffected.

---

### User Story 2 - Read the task list in detail (Priority: P1)

The developer wants each spec's tasks, not just a count, so the board can show progress ("6/9") and later views can show which phase and which task the coder is on. Each task line in the task list becomes a task with its id (for example `T012`), its text, whether it is ticked, whether it is marked `[P]` (can run in parallel), and the phase heading it sits under.

**Why this priority**: Status from "some ticked" versus "all ticked" depends on reading tasks correctly, and the board's progress bar and the timeline need the individual tasks.

**Independent Test**: Scan a fixture task list that mixes ticked and unticked tasks, `[P]` markers, several phase headings and lines that look like tasks but are not, and compare the resulting task list exactly.

**Acceptance Scenarios**:

1. **Given** the line `- [x] T003 [P] [US1] Create the config loader` under the heading `## Phase 2: Foundational`, **When** it is parsed, **Then** the task has id `T003`, done `true`, parallel `true`, phase `Phase 2: Foundational` and text `[US1] Create the config loader`.
2. **Given** the line `- [ ] T010 Write the docs` under no phase heading, **When** it is parsed, **Then** the task has done `false`, no parallel flag and no phase.
3. **Given** a task list whose lines are ticked with an upper-case `X`, **When** it is parsed, **Then** those tasks count as done.
4. **Given** a checkbox line with no task id, a task-like line inside a fenced code block, or a format description such as `[ID] [P?] [Story]`, **When** the task list is parsed, **Then** none of them becomes a task.
5. **Given** tasks in a particular order in the file, **When** they are parsed, **Then** they are returned in the same order.

---

### User Story 3 - One picture across planner and coder worktrees (Priority: P1)

The planner and the coder each work in their own git worktree of the same repo, often on different branches. The developer points the visualizer at one of them and still sees every spec from every worktree: a feature the planner has just specified on its own branch shows up even though it exists nowhere else yet. When the same feature directory exists in several worktrees, the board shows the copy from the worktree that has that feature's branch checked out, because that is where the work is really happening.

**Why this priority**: The project's own workflow uses two worktrees. Without this, the board would show stale or missing specs exactly when both agents are active.

**Independent Test**: Build a temporary git repo with two worktrees from the fixtures, put different copies of the same feature in each, check out the feature branch in one of them, and confirm the scan returns exactly one spec per feature, taken from the right worktree.

**Acceptance Scenarios**:

1. **Given** two worktrees where `005-x` exists only in the second (the planner's), **When** the repo is scanned starting from the first, **Then** `005-x` appears, recording the second worktree as its source.
2. **Given** `003-x` in both worktrees, with branch `003-x` checked out in the second, and the second copy has more tasks ticked, **When** the repo is scanned, **Then** exactly one `003-x` spec is returned, its tasks and status come from the second copy, and its source records the second worktree and branch `003-x`.
3. **Given** `003-x` in both worktrees and neither has branch `003-x` checked out, **When** the repo is scanned, **Then** exactly one spec is returned, taken from the worktree the visualizer was pointed at if it has a copy, otherwise from the first other worktree in listing order.
4. **Given** a repo with a single worktree, **When** it is scanned, **Then** the result is the same as for a plain checkout.
5. **Given** a worktree that is listed by git but whose folder no longer exists, **When** the repo is scanned, **Then** that worktree is skipped with an issue naming its path, and specs from the other worktrees still appear.

---

### User Story 4 - Merged features show as done (Priority: P2)

Once a feature's pull request is merged into `main`, the developer wants it in the done column, whether the PR was merged with a merge commit or squashed, and whether or not the feature branch has since been deleted.

**Why this priority**: Without it, every finished feature sits in `review` forever. It is P2 because the board is still useful without it.

**Independent Test**: In a temporary git repo, merge one feature branch with a merge commit and squash-merge another, delete one of the branches, and confirm both scan as `done` while an unmerged feature with all tasks ticked stays `review`.

**Acceptance Scenarios**:

1. **Given** a feature branch whose latest commit is contained in `main`, **When** the repo is scanned, **Then** the spec's status is `done`.
2. **Given** a feature that was squash-merged, so `main` contains the feature directory with a task list in which every task is ticked, **When** the repo is scanned, **Then** the status is `done`, even if the feature branch has been deleted.
3. **Given** `main` contains a feature directory whose task list still has unticked tasks (for example a spec-only PR that was merged early), **When** the repo is scanned, **Then** the status is not `done`; it is derived from the files as usual.
4. **Given** a feature with every task ticked on its branch, not merged, **When** the repo is scanned, **Then** the status is `review`.
5. **Given** a repo with no `main` branch, or a folder that is not a git repo at all, **When** it is scanned, **Then** no spec is `done` and every other status is derived from the files as usual, without an error.

---

### User Story 5 - Dogfood: the visualizer reads its own specs (Priority: P3)

The developer runs a live check against this repository's own `specs/` folder and sees features 001 and 002 as done and this feature at whatever stage it has reached, with correct titles.

**Why this priority**: It proves the adapter works on a real Spec Kit repo, not only on hand-made fixtures, but it depends on the repo's current state, so it is a confidence check rather than the main test.

**Independent Test**: Run the live check from this repo and compare its output with the actual state of `specs/` and `main`.

**Acceptance Scenarios**:

1. **Given** this repository, **When** the live check runs, **Then** it reports `001` "Server Skeleton" and `002` "Common Spec Model and Adapter Contract" as `done`, and `003` with the status its files imply.
2. **Given** the live check, **When** it runs, **Then** it does not change any file in the repository or any of its worktrees.

---

### Edge Cases

- A feature directory has a task list but no plan: the status still follows the most advanced file present (`ready` or later); a missing plan is not an error.
- A task list exists but contains no tasks: the status is `ready`.
- A specification has no `# ` heading, or an empty one: the spec is kept with its id as the title and the core reports a missing title. A heading without the `Feature Specification:` prefix is used as written.
- Two feature directories share a number (for example `007-a` and `007-b`): both produce id `007` and the core reports the duplicate.
- A task id appears twice in one task list: both tasks are kept and the core reports the duplicate task id.
- A file in a feature directory is unreadable: the scan reports an issue for that path and continues with other features.
- A worktree is on a detached HEAD: it still contributes its specs, but it never counts as having a feature branch checked out.
- The visualizer is pointed at a subfolder of a worktree, or at the planner worktree rather than the main checkout: all worktrees of the repo are still found, and the path given is still treated as the first one.
- A feature is merged into `main`, but the copy in some worktree still shows unticked tasks: the spec is `done`, since merging is the final word.
- Spec Kit's own `.specify/` folder, checklists, contracts and other files inside a feature directory never create extra specs; they are listed as artifacts of their feature.
- A repo has `.specify/` but no feature directories yet: Spec Kit is detected and the picture is empty.

## Requirements *(mandatory)*

### Functional Requirements

**Detection and discovery**

- **FR-001**: The adapter MUST report Spec Kit as present when any worktree of the repo contains a `.specify/` folder or a `specs/NNN-name/spec.md` file, where `NNN` is three or more digits and `name` is non-empty.
- **FR-002**: The system MUST find every worktree of the observed repo, each with its folder and checked-out branch (or none when detached), using git's own worktree listing as described for feature 005, and treat them all as roots of one project. The path the user gave MUST stay the first root. A folder that is not a git repo MUST be treated as a single root.
- **FR-003**: The adapter MUST ask to watch, in every root, the files that affect a spec: each feature directory's `spec.md`, `plan.md`, `tasks.md` and other files inside it.
- **FR-004**: Directories under `specs/` that do not match `NNN-name`, and matching directories without a `spec.md`, MUST produce no spec.

**Spec fields**

- **FR-005**: Each feature directory MUST produce a spec whose id is its number exactly as written (for example `003`) and whose branch is the full directory name (for example `003-speckit-adapter`).
- **FR-006**: The title MUST be taken from the first level-1 heading of `spec.md`, with a leading `Feature Specification:` removed and surrounding whitespace trimmed.
- **FR-007**: The spec's artifacts MUST list every file in its feature directory, including files in subfolders such as `contracts/` and `checklists/`, as paths relative to the root it was read from, in sorted order.
- **FR-008**: The spec MUST record its source: the root it was read from and that root's checked-out branch, when there is one.
- **FR-009**: `dependsOn` MUST be empty; Spec Kit has no standard way to declare dependencies between features.

**Tasks**

- **FR-010**: A line in `tasks.md` MUST become a task when it is a markdown checkbox (`- [ ]`, `- [x]` or `- [X]`, optionally indented) followed by a task id made of `T` and digits. All other lines, including any line inside a fenced code block, MUST be ignored.
- **FR-011**: A task MUST be done when its box holds `x` or `X`.
- **FR-012**: A task MUST be marked parallel when the marker `[P]` directly follows its id (possibly after other bracketed markers); the parallel flag MUST be absent otherwise.
- **FR-013**: A task's phase MUST be the text of the nearest preceding level-2 heading that starts with `Phase`, as written without the `## `; tasks before any such heading have no phase.
- **FR-014**: A task's text MUST be the rest of the line after the id, with the `[P]` marker removed and whitespace trimmed; other bracketed markers such as `[US1]` are kept.
- **FR-015**: Tasks MUST be returned in file order.

**Status**

- **FR-016**: Status MUST be derived as follows, the first matching rule winning: merged into `main` → `done`; `tasks.md` present with at least one task, all done → `review`; `tasks.md` present with some but not all tasks done → `in-progress`; `tasks.md` present → `ready`; `plan.md` present → `planned`; otherwise → `drafted`.
- **FR-017**: A feature MUST count as merged into `main` when its feature branch's latest commit is contained in `main`, or when `main` itself contains the feature's `tasks.md` with at least one task and every task done. This covers merge commits, squash merges and deleted branches.
- **FR-018**: When there is no `main` branch, or the repo is not a git repo, no spec MUST be `done`, and this MUST NOT be an error.

**Worktrees**

- **FR-019**: When the same feature directory exists in several roots, the adapter MUST return exactly one spec for it, taken from the root whose checked-out branch equals the directory name; if no root has it checked out, from the first root in root order that has a copy.
- **FR-020**: A feature directory that exists in only one root, of any worktree and any branch, MUST appear.
- **FR-021**: A listed worktree whose folder is missing or unreadable MUST be skipped with an issue naming its path; other worktrees MUST still be scanned.

**Read-only and boundaries**

- **FR-022**: The adapter and the worktree discovery MUST only read: no file in any worktree, and nothing in the git repository (refs, index, config, worktree list), may be created, changed or deleted.
- **FR-023**: All knowledge of Spec Kit's layout MUST stay inside the Spec Kit adapter; core code MUST remain free of framework names, as required since feature 002.
- **FR-024**: The Spec Kit adapter MUST be registered so that it is chosen automatically for a Spec Kit repo and can be forced with the `adapter` config key under the name `speckit`.

**Fixtures and live check**

- **FR-025**: `fixtures/speckit/` MUST contain a fixture repo with at least one feature for each file-derived status (`drafted`, `planned`, `ready`, `in-progress`, `review`), plus the non-matching directories and tricky task lines from the edge cases above.
- **FR-026**: Scenarios that need git (worktrees, merged features) MUST be tested on temporary git repos built from the fixtures during the test, never on the fixture folder itself and never on this repo.
- **FR-027**: A live check MUST exist that runs the adapter against this repository and all its worktrees and reports each spec's id, title and status. It is run on demand and is not part of the default fixture-based test run.

**Documentation**

- **FR-028**: The adapter guide MUST describe the Spec Kit adapter: what it detects, how status is derived, how tasks are read, how worktree copies are chosen and how to run the live check.

### Key Entities

- **Feature directory**: A folder `specs/NNN-name/` in one worktree. Holds the specification, and later the plan, task list and supporting files. One feature directory (after choosing among worktree copies) becomes one spec.
- **Task line**: One checkbox line in a task list with a task id, optional `[P]` marker and other bracketed markers, and a description. Belongs to the nearest phase heading above it.
- **Worktree**: One checked-out folder of the repo, with the branch it has checked out (or detached). All worktrees of a repo share one history and are scanned as one project.
- **Main line**: The `main` branch, used only to decide whether a feature is done.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Scanning the fixture repo gives the expected status for 100% of its features, one per file-derived status.
- **SC-002**: For every task line in the fixture task list, id, text, done, parallel and phase match the expected values exactly, and none of the decoy lines becomes a task.
- **SC-003**: In a two-worktree test repo, every feature appears exactly once, and for every feature checked out on its own branch, the reported tasks match that worktree's copy.
- **SC-004**: A feature merged by merge commit and one merged by squash are both reported `done`, including after their branches are deleted, and an unmerged fully ticked feature is reported `review`.
- **SC-005**: The live check against this repo reports features 001 and 002 as `done` with their correct titles.
- **SC-006**: After any scan or live check, the observed repo and its worktrees contain zero files created, modified or deleted, and the repo's branches and worktree list are unchanged.
- **SC-007**: Scanning a repo with 20 feature directories across two worktrees completes in under one second on a developer laptop.

## Assumptions

- The common model, adapter contract, validation, registry and watcher from feature 002 are used unchanged; this feature adds the first concrete adapter and the list of roots it runs on.
- Feature 005 (git ingester) is not built yet. This feature lists worktrees and their branches in the way 005 describes (git's porcelain worktree listing), only as far as the adapter needs; 005 will take over or reuse it.
- The main line is the local branch named `main`. Other names (such as `master` or a configured default) are out of scope for now.
- Squash merges are recognized by the merged task list on `main`, because this project squash-merges pull requests and its feature branches are often not ancestors of `main`.
- The spec id is the feature number (`003`), matching the `[spec-NNN]` commit tags, rather than the full directory name, which is kept as the branch.
- Dependencies between Spec Kit features are not read; the dependency graph (feature 008) will show Spec Kit specs unconnected until a later feature defines a way to declare them.
- The `blocked` status is never produced by this adapter; Spec Kit has no explicit blocked marker.
- Git-only changes, such as a merge into `main` or a branch switch in another worktree, are reflected on the next scan; triggering a rescan on git changes alone is left to features 005 and 006.
- Fixture folders cannot contain their own git repositories, so git-dependent scenarios build temporary repos from the fixture files at test time.
- The live check is allowed to read this machine's real repo because it is an explicit, on-demand check; all automated tests use fixtures, as the constitution requires.
