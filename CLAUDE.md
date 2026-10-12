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

## Commands
`bun install` · `bun run dev -- <repo-path>` · `bun run build` · `bun test` · `bun run verify`
