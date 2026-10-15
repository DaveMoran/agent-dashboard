# Contract: Read-only Git Access

Defined in `src/git/`. Framework-agnostic; feature 005 will reuse it. Must not import from `src/server/`, `src/cli/` or `src/adapters/`.

## run.ts

```ts
export interface GitResult { code: number; stdout: string; stderr: string }
export function runGit(cwd: string, args: string[]): Promise<GitResult>;
```

- Spawns `["git", "-C", cwd, ...args]` with `env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }`, `stdin: "ignore"`, stdout and stderr piped.
- Resolves with the exit code and full output text. Never rejects: if spawning fails (for example `git` not on `PATH`), resolves `{ code: -1, stdout: "", stderr: <error message> }`.
- Callers may only pass read-only subcommands. This feature uses exactly: `rev-parse`, `worktree list --porcelain`, `symbolic-ref`, `show`.

## worktrees.ts

```ts
export interface Worktree { path: string; branch: string | null; bare: boolean; prunable: boolean }

export function parseWorktreePorcelain(text: string): Worktree[];
export function listWorktrees(cwd: string): Promise<Worktree[]>;      // [] when not a git repo or git missing
export function currentBranch(cwd: string): Promise<string | null>;
export function resolveRoots(repoPath: string): Promise<string[]>;
```

### parseWorktreePorcelain

Blocks are separated by empty lines. In each block: `worktree <path>` starts the entry; `branch refs/heads/<name>` sets `branch` (a `branch` line not starting with `refs/heads/` uses the value as given); `detached` leaves `branch` null; `bare` sets `bare`; `prunable` or `prunable <reason>` sets `prunable`. `HEAD` and `locked` lines are ignored. Blocks without a `worktree` line are skipped.

Example input → output:

```text
worktree /r
HEAD 447d36d
branch refs/heads/main

worktree /w1
HEAD 447d36d
branch refs/heads/003-x

worktree /w2
HEAD 447d36d
detached
prunable gitdir file points to non-existent location
```

→ `[{ path: "/r", branch: "main", bare: false, prunable: false }, { path: "/w1", branch: "003-x", bare: false, prunable: false }, { path: "/w2", branch: null, bare: false, prunable: true }]`

### currentBranch

`git symbolic-ref --quiet --short HEAD`: exit 0 → trimmed stdout; anything else → null.

### resolveRoots

1. `git rev-parse --show-toplevel` in `repoPath`. Non-zero exit → return `[repoPath]`.
2. `top` = trimmed stdout. `listWorktrees(repoPath)`.
3. Return `[top, ...worktrees.filter(w => !w.bare && w.path !== top).map(w => w.path)]`, in listing order, without duplicates.

Missing (`prunable`) worktrees stay in the list; the 002 scan reports them as `unreadable-path` and continues.

| Input | Result |
|---|---|
| Plain folder, not git | `[repoPath]` |
| Main checkout `/r` with worktree `/w1` | `["/r", "/w1"]` |
| `/w1` (the planner worktree) | `["/w1", "/r"]` |
| `/r/sub` (subfolder) | `["/r", "/w1"]` |
| `/r` with deleted worktree `/w2` | `["/r", "/w2"]` |
