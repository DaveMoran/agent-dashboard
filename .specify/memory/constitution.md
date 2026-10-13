# Agent Visualizer Constitution

## Core Principles

### I. Feature Branches and Pull Requests Only (NON-NEGOTIABLE)
All work happens on a feature branch named after its spec (`NNN-feature-name`, as created by Spec Kit). Nothing is ever committed or pushed directly to `main`. Every feature branch ends in a pull request, and `main` only changes by merging a PR. If an agent finds itself on `main`, it must switch to (or create) the correct feature branch before making any change.

### II. Documentation Ships With the Code (NON-NEGOTIABLE)
Every spec must update all documentation its change affects, in the same branch and PR. This includes the `README.md`, anything under `docs/`, `docs/master-spec.md` when decisions or architecture change, and inline docs for public interfaces. Each `tasks.md` must contain an explicit documentation task, and a feature is not complete until it is checked off.

### III. Read-Only Observer
Agent Visualizer only observes the target repo, its Claude Code transcripts and its git history. It never writes to, commits to, or modifies the repo it is pointed at, and never edits transcript files. Any future control features need their own constitutional amendment.

### IV. Framework-Agnostic Through Adapters
Spec framework knowledge (Spec Kit, OpenSpec, BMAD, plain markdown) lives only inside adapters. Core code, ingesters and UI depend on the common spec model, never on a specific framework's file layout.

### V. Test-Backed and Fixture-Driven
Logic is covered by `bun test`. Adapters and ingesters are tested against fixtures in `fixtures/`, not against live machine state. A feature's tests must pass before its PR is opened. A test must be able to fail: it asserts specific behavior (for example the exact error type and exit code), and breaking the code it covers must make it fail. A test that catches and ignores errors, or only checks that something threw, does not count.

### VI. Small, Explicit Tasks
Specs are written so a mid-sized local model can execute them: tasks are small and mechanical, name the files they touch, and state their acceptance check. Prefer simplicity (YAGNI) over cleverness; justify any added dependency in the plan.

### VII. Commit at Every Workflow Step (NON-NEGOTIABLE)
Each Spec Kit step (`specify`, `clarify`, `plan`, `tasks`, `analyze`/`checklist`, `implement`) ends with its output committed to the feature branch. Before starting any step, the agent MUST check that the previous step's files are committed (`git status` shows no uncommitted changes under `specs/NNN-*/` or `.specify/`). If they are not, the agent switches to the feature branch (creating it from `main` if it does not exist) and commits them first, before doing any new work, so that these commits are the earliest on the branch. Never carry a previous step's uncommitted files into the next step.

### VIII. Logical, Incremental Commits (NON-NEGOTIABLE)
Commit work as it is done, not at the end. Each commit is one logical unit, typically a single task or a few tightly related tasks from `tasks.md`, with its tests, and leaves the test suite passing where practicable. Do not mix unrelated changes in one commit, and do not batch a whole feature into a single closing commit. Documentation updates are committed with the change they describe or as their own clearly labeled commit. The goal is that a reviewer can read the PR commit by commit and isolate each level of logic. Every commit message is imperative, describes what the commit does, and ends with the `[spec-NNN]` tag; spec-workflow commits use the form `docs(spec-NNN): add <artifact> [spec-NNN]` (for example `docs(spec-001): add specification [spec-001]`).

## Technology Constraints
- TypeScript in strict mode throughout.
- Bun for the runtime, package management and tests.
- React with Vite for the UI; React Flow for graph views; Server-Sent Events for live updates.
- Local-only: no network calls, telemetry or accounts.

## Development Workflow
1. Planner (Claude, plan mode) writes the spec, plan and tasks on the feature branch. Before each step it verifies the previous step's files are committed, and it commits its own output when the step finishes (Principle VII).
2. Coder (Qwen via Claude Code) implements the tasks on the same branch, checking each box in `tasks.md` as it completes it and committing logical units as it goes, each tagged `[spec-NNN]` (Principle VIII).
3. Before opening the PR: tests pass, documentation task is complete, and the README and `docs/` reflect the change.
4. The PR description summarizes the spec, links the spec directory and lists the documentation updated. A human reviews, commit by commit, and merges.

## Governance
This constitution supersedes other practices. Amendments require a PR that updates this file with a version bump and a note explaining why. Every PR review verifies compliance with these principles, and any deviation must be justified in the plan's complexity section. Where practical, the non-negotiable rules are also enforced mechanically rather than by instruction alone: git hooks in `.githooks/` (no commits or pushes on `main`, required `[spec-NNN]` tag), GitHub branch protection on `main` (pull request required, including for the maintainer) and Claude Code settings and hooks in `.claude/` (blocked commands, commit-before-stop for the coder). `CLAUDE.md` holds the short operational form of these rules for agents; this file remains the source of truth.

**Version**: 1.2.1 | **Ratified**: 2026-10-12 | **Last Amended**: 2026-10-12

**Amendment 1.1.0**: Added Principle VII (commit at every workflow step) and Principle VIII (logical, incremental commits) so reviews can isolate each step and each level of logic.

**Amendment 1.2.0**: Principle V now requires tests that can fail (the first coder run produced tests that passed with the code removed). Governance now records mechanical enforcement via `.githooks/` and `.claude/`, and `CLAUDE.md` as the operational summary.

**Amendment 1.2.1**: Enforcement of Principle I extended to pushes (`.githooks/pre-push`) and to the remote (branch protection), after a direct push to `main` showed the commit-time guard was not enough.
