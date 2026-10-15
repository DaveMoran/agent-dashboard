# Quickstart: Spec Kit Adapter

How to check the feature works. Details of each rule are in [contracts/speckit-adapter.md](./contracts/speckit-adapter.md) and [contracts/git.md](./contracts/git.md).

## Prerequisites

- Bun >= 1.2 and `git` on `PATH`.
- `bun install` done; on branch `003-speckit-adapter`.

## 1. Automated checks

```sh
bun run verify
```

Expect type check clean and all tests passing, including:

| Test file | Proves |
|---|---|
| `tests/speckit-parsers.test.ts` | Directory names, titles, every line of `tasks-tricky.md`, status table, authority table |
| `tests/speckit-adapter.test.ts` | Fixture repo: one spec per status, ignored dirs, artifacts, `missing-title` for 008, adapter registered and detected as `speckit` |
| `tests/speckit-git.test.ts` | Merge commit, squash, deleted branch → `done`; unmerged fully ticked → `review`; fresh branch, partial on `main`, no `main`, not git → not `done` |
| `tests/speckit-worktrees.test.ts` | Planner-only spec appears; checked-out branch wins; detached never wins; missing worktree gives `unreadable-path`; nothing written |
| `tests/git-worktrees.test.ts` | Porcelain parsing and `resolveRoots` table |

## 2. Live check on this repo

```sh
bun run live-check
```

Expected today (the planner worktree at `../agent-visualizer-planner` is detached, so it never wins):

- A `root` line for this checkout and one for the planner worktree.
- `001  done  Server Skeleton` and `002  done  Common Spec Model and Adapter Contract`.
- `003` with the status its files imply (`planned` once this plan is committed, `ready` after `/speckit-tasks`, then `in-progress` and `review` as tasks are ticked; `done` only after the PR is merged and local `main` is pulled).
- Exit code 0.

Then confirm nothing changed:

```sh
git status --short          # empty
git -C ../agent-visualizer-planner status --short   # empty
```

## 3. Worktree behavior by hand (optional)

```sh
git worktree add -b 099-demo ../av-demo main
mkdir -p ../av-demo/specs/099-demo && printf '# Feature Specification: Demo\n' > ../av-demo/specs/099-demo/spec.md
bun run live-check          # 099  drafted  Demo  [.../av-demo, 099-demo]
git worktree remove --force ../av-demo && git branch -D 099-demo
```
