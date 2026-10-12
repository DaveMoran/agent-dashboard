# Local setup: planner + local coder

How to run the two-session workflow on a Mac. Machine-specific numbers here (context size, memory) are measured on an M-series MacBook Pro with 36 GB and will differ on other hardware.

## Roles

| Session | Model | Where | What it does |
|---|---|---|---|
| Planner | Claude (plan mode) | Planner worktree | Runs `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`; reviews the coder's work |
| Coder | `qwen3-coder:30b` via Ollama | Main checkout | Runs `/speckit-implement` |

Rules for both are in `CLAUDE.md` (short) and `.specify/memory/constitution.md` (principles).

## One-time setup

1. Install Bun (>= 1.2) and Ollama, then `ollama pull qwen3-coder:30b`.
2. Enable the repo's git hooks: `git config core.hooksPath .githooks`. This refuses commits on `main` and requires the `[spec-NNN]` tag on spec branches. The setting is shared by all worktrees of the repo.
3. Add the shell helpers below to `~/.zshrc`.
4. Create the planner worktree: `git worktree add -b <branch> ../agent-visualizer-planner main`. The planner and coder can then be on different branches at the same time. List worktrees with `git worktree list`; remove one after its branch is merged with `git worktree remove <path>`.

## Shell helpers

```zsh
export AV_CTX=98304   # context window; restart both helpers after changing
unalias ollama-serve 2>/dev/null
ollama-serve() { caffeinate -ims env OLLAMA_CONTEXT_LENGTH=${AV_CTX:-98304} OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve "$@"; }
claude-coder() { caffeinate -ims env AV_ROLE=coder CLAUDE_CODE_MAX_CONTEXT_TOKENS=${AV_CTX:-98304} ollama launch claude --model qwen3-coder:30b -- --permission-mode acceptEdits "$@"; }
```

- `ollama-serve` starts the server with a large context window, flash attention and an 8-bit KV cache. Quit the Ollama menu-bar app first or the port is taken.
- `claude-coder` starts the coder session. `AV_ROLE=coder` turns on the Stop hook (`.claude/hooks/require-commit.sh`), which blocks the session from ending with uncommitted work. The planner session does not set it.
- `--permission-mode acceptEdits` auto-approves file edits, and Bash commands are allowed by the `allow` list in `.claude/settings.json` (the `deny` list always wins). Do not use auto mode with the local model: auto mode asks the model to vet every Bash command, that call timed out on the local model ("auto mode cannot determine the safety of Bash"), and the coder could not run `bun install`. A command not on the allow list pauses at a prompt until you answer; add it to the list if it is safe.
- `caffeinate -ims` keeps the Mac from sleeping while they run. Keep the machine plugged in with the lid open; a sleeping Mac stalls the in-flight model request (a first run lost about three hours this way).

## Why the large context window

Claude Code's startup prompt is about 31-35k tokens. With Ollama's default 32k window the model had room for almost no output and returned empty replies. 64k worked but left about 29k tokens of working room and the session compacted after reading large files. 96k (`98304`) is the current setting. Check it with `ollama ps` (CONTEXT column) after the first request, and watch `sysctl vm.swapusage` on long runs. Run `/context` in a session to see what uses the startup tokens.

## Guardrails

| Rule | Enforced by |
|---|---|
| No commits on `main` | `.githooks/pre-commit` |
| Commit subject ends with `[spec-NNN]` on spec branches | `.githooks/commit-msg` |
| Coder cannot stop with uncommitted work | `.claude/hooks/require-commit.sh` (Stop hook, `AV_ROLE=coder` only) |
| No `brew`, `sudo`, global installs, `--no-verify`, force pushes, pushes to `main`, or summary files | Deny rules in `.claude/settings.json` |
| Tests and type check before a task is done | `bun run verify` (stated in `CLAUDE.md`) |

Hooks and `CLAUDE.md` are read when a session starts. Restart a session after they change.

## Per-spec workflow

1. Planner worktree: `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, committing after each step.
2. Merge or cherry-pick those commits to the branch the coder uses.
3. Coder: `/speckit-implement` one phase at a time (for example "Phase 3 only"), committing per task.
4. Planner reviews the commits, then a human reviews the PR commit by commit and merges.
