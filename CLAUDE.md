# Agent Visualizer: rules for every session

Principles and reasons live in `.specify/memory/constitution.md`. This is the short operational form.

## All sessions
- Never work on `main`. Run `git branch --show-current` first; work on the `NNN-feature` branch for the active spec.
- Commit as you go, one logical unit at a time. Every commit subject ends with `[spec-NNN]`. Never use `--no-verify`.
- Before starting a Spec Kit step, make sure the previous step's files are committed.
- The app is a read-only observer: it must never write into the repo it observes.

## Coder session (local model)
- Work through `specs/NNN-*/tasks.md` in order. Tick a task's box in the same commit as the task's code.
- Run `bun run verify` (type check + tests) before calling a task done. A test must fail if the code it covers is broken.
- Run code through test files and `bun test`. Never `bun run -e`.
- Do not install system software (brew, sudo, global npm). If a tool is missing, stop and tell the human.
- Do not create summary or status files. Do not write `README.md` before the documentation task.
- Do not edit `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/` or the constitution.
- If the same command fails twice, stop and explain in your reply. Do not try a third approach.
- Read large files in pieces (offset and limit). Your context window is limited.

## Parallel tasks (planner running /speckit-implement)
- Run coder subagents one at a time by default.
- `[P]` tasks in the same phase may run as parallel coder subagents in this checkout (no worktrees). Tell each one it is in parallel mode and name its files.
- A parallel coder writes only the files its task names, runs only its own test file (`bun test tests/<file>.test.ts`), and does not commit, tick `tasks.md` or run `bun run verify`.
- When the batch is done, the planner runs `bun run verify` once, then commits each task separately in task-ID order, with its box ticked in that commit.
- Never run tasks in parallel that touch the same file, add a dependency, or need the full test suite or a build to check them.

## Tester and coder (planner running /speckit-implement)
- Tasks that add or change logic go tester → coder: the `tester` agent writes the task's tests from the spec and contracts (it does not read the implementation); the `coder` agent then implements until they pass and must not change those tests.
- Neither commits. The planner runs `bun run verify`, then commits tests, code and the ticked box in one commit per task.
- Wiring-only and docs tasks may go to a single coder. Fixture-only tasks go to the tester.
- The parallel rules above apply to testers and coders alike.
- Live and dogfood checks stay with the planner: a tester checks the spec is met, not that the spec is right.

## Commands
`bun install` · `bun run dev -- <repo-path>` · `bun run build` · `bun test` · `bun run verify`
