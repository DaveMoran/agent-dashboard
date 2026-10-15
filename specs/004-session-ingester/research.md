# Research: Session Ingester

All findings about the transcript format come from inspecting the structure (entry types, keys, block types, `stop_reason`) of real transcripts on this machine (Claude Code as of 2026-10), not their content.

## R1. Where transcripts live, and which files are sessions

**Decision**: A session is a file matching `<root>/<project-folder>/<name>.jsonl`, exactly two levels below the root. Everything deeper is ignored, in particular `<root>/<project-folder>/<session-uuid>/subagents/agent-*.jsonl` (subagent transcripts, with sibling `.meta.json` files) and other per-session folders (`tool-results/`, error files).

**Rationale**: Subagent transcripts carry the *parent's* `sessionId` and `isSidechain: true`; counting them would create phantom sessions or collide with the parent (FR-002, US3 scenario 5). The project folder name is a lossy encoding of the cwd (`/` → `-`), so it is not used for grouping; the `cwd` field on entries is.

**Alternatives considered**: reading subagent transcripts to mark subagent activity: deferred to the project view (later), not needed for V1 state.

## R2. Line shapes and the fields we keep

**Decision**: Parse each complete line with `JSON.parse`; keep only `type`, `timestamp`, `sessionId`, `cwd`, `isMeta`, `subtype` (system entries), and from `message`: `model`, `stop_reason`, and the content block types plus `tool_use.id` / `tool_result.tool_use_id`, and the first 40 characters of user text (only to classify it, never stored). Full rules in [contracts/transcript-format.md](./contracts/transcript-format.md).

Observed facts the rules rely on:

- Top-level `type` values include `user`, `assistant`, `system`, and many bookkeeping types (`attachment`, `api-request`, `api-request-blob`, `file-history-snapshot`, `file-history-delta`, `mode`, `permission-mode`, `last-prompt`, `queue-operation`, `ai-title`, `pr-link`, `cost-state`, `agent-name`, `continued-in`, ...). New ones appear between Claude Code versions, so unknown types must be harmless.
- An assistant message is written as **one entry per content block** (`thinking`, `text`, `tool_use`), sharing `message.id`. `message.stop_reason` is `tool_use` or `end_turn` on the blocks of a completed message, and `null` on blocks of a message that was still streaming (seen right before an interruption, and on intermediate blocks).
- The model is `message.model` (e.g. `claude-opus-5-5`). Synthetic messages (API errors) use `<synthetic>`, which must not overwrite the known model.
- A completed turn is followed by `system` entries `stop_hook_summary` (when stop hooks exist) and `turn_duration`. `turn_duration` was present after every completed turn inspected and absent after interruptions.
- Interruptions are user entries whose text starts with `[Request interrupted by user` (also `... for tool use]`).
- Local slash commands (`/model`, `/clear`, ...) write user entries whose string content starts with `<local-command-caveat>` (with `isMeta: true`), `<command-name>` or `<local-command-stdout>`; they do not start a turn. Skill invocations start with `<command-message>` and do start a turn, followed by an `isMeta` user entry with the skill body. `!` shell commands write `<bash-input>` / `<bash-stdout>` / `<bash-stderr>` entries and do not start a turn.
- Tool results are user entries whose content array contains `tool_result` blocks (sometimes plus `text`).
- Bookkeeping lines can be several MB (`api-request-blob`).

**Rationale**: FR-004 asks for the minimum; nothing that holds conversation text is retained.

**Alternatives considered**: a schema library (zod etc.): rejected, no new dependency for a dozen field checks.

## R3. Working vs standby rule

**Decision**: "The last state-bearing entry decides." Entry kinds `prompt`, `tool-call`, `tool-result`, `progress` (assistant block with `stop_reason: null` or `tool_use` but no tool call in this block) make the session `working`. Kinds `final` (assistant block with a non-null `stop_reason` other than `tool_use` and no tool call), `turn-end` (`system/turn_duration`) and `interrupt` make it `standby`. Kind `other` leaves state unchanged but updates last activity when timestamped. A session with no state-bearing entry yet is `standby`.

Open tool-call IDs are also tracked (added on `tool-call`, removed on `tool-result`, cleared on `final`/`turn-end`/`interrupt`) for diagnostics and for 005, but the state rule does not need them: while any call is open, the last state-bearing entry is a call or a result (both `working`); the model only writes a final block after all results are in.

**Rationale**: Simple, order-based, and correct for: plain turns, parallel tool calls, a foreground subagent (its `Agent` tool call stays open in the parent until the subagent returns), interrupted streams (`null` blocks then interrupt → standby), API errors (`<synthetic>` final → standby), and local slash commands (classified `other`). Using both `final` and `turn-end` makes standby robust if either marker is missing in some version.

**Alternatives considered**: deriving state only from open tool calls plus `end_turn`: fails on interrupted streams. Using `turn_duration` alone: undocumented and absent on interrupt.

**Known limitation (recorded for the user)**: a subagent launched **in the background** returns its tool result immediately, so the main turn can end (`standby`) while the subagent still works; its completion arrives later as a new user entry (a task notification), which starts a new `working` turn. Transcript-only state cannot show "standby but a background subagent is running" without reading subagent transcripts. Foreground subagents, the setup used for `/speckit-implement`, are handled correctly. Revisit with the project view (which reads subagent transcripts) or 005.

## R4. Incremental tailing

**Decision**: Per file keep `{ offset, pending: Uint8Array, size, mtimeMs }`. On each read: `stat`; if `size < offset` (truncated or replaced), reset offset and pending and rebuild that file's session state from scratch; if `size == offset` and mtime unchanged, do nothing; otherwise read bytes `[offset, size)` with `Bun.file(path).slice(offset, size).bytes()`, prepend `pending`, split at the **last `\n` byte**, decode the complete part as UTF-8, split into lines, keep the remainder bytes as `pending`, and set `offset = size`.

**Rationale**: Splitting on bytes before decoding avoids corrupting a multi-byte UTF-8 character cut at a chunk boundary (a classic bug that string-level tailing has). `Bun.file().slice()` opens read-only and does not lock. A partial line is only ever completed by later bytes, so holding it back is exact (FR-003).

**Alternatives considered**: `fs.createReadStream` per change: more moving parts for the same result. Re-reading whole files: violates FR-003 and SC-003.

## R5. First read of large files (tail window)

**Decision**: On first sight of a file larger than a window (default 2 MiB), read only the last window: start at `size - window`, drop bytes up to and including the first `\n` (a partial line), and fold the rest. If the folded window contains **at least one assistant entry with a real model and at least one state-bearing entry**, accept it. Otherwise discard and fold the whole file from offset 0. Either way the offset ends at `size`.

**Rationale**: Every value the session keeps is a "latest" value (state = last state-bearing entry, model = last real model, cwd/sessionId = last seen, last activity = max timestamp), so a suffix that contains the last state-bearing entry and the last model gives exactly the full-file result, except for open tool-call IDs opened before the window, which are only diagnostic. This keeps the first start within SC-003 on large histories. A test asserts window and full reads give equal state, model, cwd and last activity.

**Alternatives considered**: always reading everything: 500 MB of `JSON.parse` including multi-MB blob lines risks the 10 s budget. Prefiltering lines by substring before parsing: fragile.

## R6. Discovering changes: polling, not `fs.watch`

**Decision**: A single poll loop (default every 500 ms, configurable for tests, and a public `refresh()` that tests call directly). Each pass: if the root is missing, report nothing; else `readdir` the root, `readdir` each project folder, collect top-level `*.jsonl`, and `stat` each; read only files whose size or mtime changed. Passes never overlap (a pass that is still running makes the next tick skip).

**Rationale**: Meets the 1 s target (SC-002) with a cost of a few dozen `readdir`s and a few hundred `stat`s per pass. It is deterministic and testable without timing flakiness, handles the root appearing later (FR-011) and new folders for free, and never subscribes to the very noisy recursive tree under `~/.claude/projects` (subagents, tool results). Polling cannot "miss" an append: sizes are compared every pass.

**Alternatives considered**: recursive `fs.watch` (as `src/core/watcher.ts` does for specs): event storms from subagent and tool-result writes, platform differences, and still needs a fallback poll. Rejected for this source.

## R7. Project identity

**Decision**: `git -C <cwd> rev-parse --path-format=absolute --git-common-dir` via the existing `runGit` (read-only, `GIT_OPTIONAL_LOCKS=0`). Success → project id = that path; name = basename of its parent when the path ends in `/.git`, otherwise the basename with a trailing `.git` removed (bare repos). Failure (not a repo, folder missing, git missing) → project id = the cwd as recorded, name = its basename. Results are cached per cwd for the source's lifetime (a cwd does not move between repos while running).

**Rationale**: The common dir is shared by all worktrees (FR-006, US2). `--path-format=absolute` (git ≥ 2.31; local 2.54) avoids relative `.git` answers. Caching keeps git calls to one per distinct cwd.

**Alternatives considered**: `--show-toplevel`: differs per worktree. Parsing `.git` files by hand: duplicates git logic.

## R8. Session identity and duplicates

**Decision**: A session's ID is the latest `sessionId` seen in its file, falling back to the file name without `.jsonl`. If two files report the same session ID, only the one with the most recent last activity is reported; the other is kept internally (it may become the newer one).

**Rationale**: Matches FR-002 and the spec edge case. Using the latest (not first) ID avoids misattributing a file that starts with copied history.

## R9. Main-agent pattern and settings

**Decision**: `agent-visualizer.config.json` gains two optional string settings: `mainAgentModel` (regex source, default `^claude-(opus|fable)`) and `transcriptsDir` (default `~/.claude/projects`). Environment variable `AGENT_VISUALIZER_TRANSCRIPTS_DIR` overrides `transcriptsDir` (tests, e2e). A non-string value is a `ConfigValueError` like other settings. A string that is not a valid regex is **not** fatal: `compileMainAgentPattern` returns the default regex plus a warning naming `mainAgentModel` and the regex error, which the CLI prints to stderr at startup (spec US3 scenario 3).

**Rationale**: Fits the existing config loader; the spec asks for fall-back rather than exit on a bad pattern.

## R10. Agent source interface shape

**Decision**: See [contracts/agent-source.md](./contracts/agent-source.md). `start()` performs one full pass before resolving, so `sessions()` is complete afterwards; listeners subscribed before `start()` receive `session-added` for the initial sessions. Events: `session-added`, `session-updated` (model, main-agent flag, cwd or project changed), `state-changed` (exactly once per actual change, with `from`, `to` and the causing entry's timestamp). The source reports **all** sessions with an `isMain` flag; filtering is the consumer's job, so a hook source (005) that knows no model can still contribute.

**Rationale**: Minimal surface that 005 (combining sources) and 006 (brain slots) need; event semantics are testable with a stub.

## R11. Fixtures

**Decision**: Hand-trimmed JSONL built from the real shapes in R2, one folder per scenario under `fixtures/transcripts/`, laid out like the real root. Working directories use placeholders (`{{REPO}}`, `{{WORKTREE}}`, `{{PLAIN}}`, `{{MISSING}}`) that a test helper replaces after creating temp git repos and copying the scenario into a temp root. All user and assistant text is replaced with short neutral strings; bookkeeping lines keep only their `type` and `timestamp` plus a padding field where size matters.

**Rationale**: Project grouping needs real git repos; temp copies also guarantee tests never append to checked-in files. Trimming satisfies FR-015.
