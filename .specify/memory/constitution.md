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
Logic is covered by `bun test`. Adapters and ingesters are tested against fixtures in `fixtures/`, not against live machine state. A feature's tests must pass before its PR is opened.

### VI. Small, Explicit Tasks
Specs are written so a mid-sized local model can execute them: tasks are small and mechanical, name the files they touch, and state their acceptance check. Prefer simplicity (YAGNI) over cleverness; justify any added dependency in the plan.

## Technology Constraints
- TypeScript in strict mode throughout.
- Bun for the runtime, package management and tests.
- React with Vite for the UI; React Flow for graph views; Server-Sent Events for live updates.
- Local-only: no network calls, telemetry or accounts.

## Development Workflow
1. Planner (Claude, plan mode) writes the spec, plan and tasks on the feature branch.
2. Coder (Qwen via Claude Code) implements the tasks on the same branch, checking each box in `tasks.md` as it completes it and tagging commits with `[spec-NNN]`.
3. Before opening the PR: tests pass, documentation task is complete, and the README and `docs/` reflect the change.
4. The PR description summarizes the spec, links the spec directory and lists the documentation updated. A human reviews and merges.

## Governance
This constitution supersedes other practices. Amendments require a PR that updates this file with a version bump and a note explaining why. Every PR review verifies compliance with these principles, and any deviation must be justified in the plan's complexity section.

**Version**: 1.0.0 | **Ratified**: 2026-10-12 | **Last Amended**: 2026-10-12
