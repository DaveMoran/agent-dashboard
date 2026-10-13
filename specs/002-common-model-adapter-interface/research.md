# Research: Common Spec Model and Adapter Contract

No `NEEDS CLARIFICATION` items remained. The decisions below settle the open design questions.

## 1. How to watch files

- **Decision**: `fs.watch(root, { recursive: true })` on each root, filtering events by the adapter's patterns. Paths under `.git/` and `node_modules/` are ignored before matching.
- **Rationale**: Verified on this machine (Bun 1.4.3, macOS): a recursive watch on a root reports creation of nested new directories (`specs/001-x`, `deep/a/b/c`), files inside them, atomic saves (write temp + rename) and recursive deletion. Watching the root, not just a base folder, also covers a spec folder that does not exist yet (spec edge case) with no extra logic.
- **Alternatives**: Watch only the adapter's base folders (needs special handling when they appear or disappear); polling (simple but slow and wasteful); a watcher library such as chokidar (a dependency the constitution asks us to justify, and not needed on macOS).
- **Risk**: Recursive `fs.watch` on Linux in Bun is unverified. The watcher test suite exercises nested creation; if it fails on Linux, the fallback is to add a periodic rescan, which keeps the same notification contract.

## 2. Adapter interface shape

- **Decision**: All three operations take a `RepoContext { roots: string[] }` (absolute real paths, first root is the one the user pointed at). `detect(ctx) -> Promise<boolean>`; `discover(ctx) -> Promise<WatchTarget[]>` where `WatchTarget { root, patterns: string[] }` uses glob patterns relative to that root; `parse(ctx, files: string[]) -> Promise<unknown[]>` receives absolute paths of the files that matched.
- **Rationale**: Meets "accepting one or more roots" (FR-006). The core expands patterns with `Bun.Glob`, so adapters never touch globbing and parse stays a pure "files to specs" step that is easy to test. Returning `unknown[]` makes the core the only place that trusts or rejects data (FR-010).
- **Alternatives**: Adapters return already-typed `Spec[]` (lets bad data bypass validation); `discover` returns file lists directly (forces each adapter to implement globbing and makes watch filtering harder).

## 3. Validation strategy

- **Decision**: Hand-written validation in `validate.ts`. Order: shape checks per spec (drop specs without a usable string `id`, with issue `invalid-shape`), title fallback, status check (drop with `invalid-status`), task checks (drop malformed tasks with `invalid-task`, report `duplicate-task-id`), duplicate spec ids (keep first), then dependency checks on the accepted set (`unresolved-dependency`, `self-dependency`, `dependency-cycle`). Unknown fields are dropped from accepted specs.
- **Rationale**: Matches the spec's keep/exclude rules exactly and keeps output deterministic. No schema library, consistent with 001.
- **Alternatives**: A schema library (dependency, and custom keep/exclude rules would still be hand-written); passing unknown fields through (no consumer needs them yet; can be added later as an explicit `meta` field).

## 4. Cycle detection

- **Decision**: Tarjan's strongly connected components over accepted specs and resolved dependencies. Each component with more than one spec is one `dependency-cycle` issue listing its ids sorted. A spec depending on itself is reported only as `self-dependency`.
- **Rationale**: Reports each cycle once (FR-016), linear time, deterministic with sorted ids.
- **Alternatives**: DFS reporting every back edge (reports the same cycle several times).

## 5. Debounce and maximum delay

- **Decision**: Quiet period 150 ms, maximum delay 2,000 ms, both passed as options with these defaults. A change starts (or extends) the quiet timer; if changes keep arriving, a scan runs at the maximum delay anyway. Scans never overlap: changes during a scan schedule one more scan after it ends.
- **Rationale**: 150 ms coalesces editor and agent bursts and keeps single-change latency well under 1 s (SC-004, SC-005); 2 s maximum keeps staleness well under the 5 s bound (SC-006).
- **Alternatives**: Pure trailing debounce (can starve under constant change); fixed-interval polling (latency always equals the interval).

## 6. Where the forced adapter is read and checked

- **Decision**: `loadConfig()` returns an optional `adapter: string`; a non-string value is a `ConfigValueError` naming the file. The CLI calls `assertKnownAdapter(config.adapter, registry)` at startup and exits 1 with `UnknownAdapterError` listing available names (or "none registered"). Detection itself is not run at startup in this feature.
- **Rationale**: Satisfies FR-023/FR-024 ("stop the tool") without changing the CLI's three startup lines or doing work nothing consumes yet. Selection runs when the watcher is wired up in feature 006.
- **Alternatives**: Running full selection at startup and printing the adapter (changes the 001 CLI output contract; nothing uses the result yet).

## 7. Where the stub adapter and fixtures live

- **Decision**: `fixtures/stub/adapter.ts` plus fixture repos under `fixtures/stub/`. The stub reads `stub-specs/*.json` (one spec per file) and throws if a file's content is exactly `FAIL`, so tests can trigger parse failures through file changes. `tsconfig.json` includes `fixtures`.
- **Rationale**: Constitution Principle V says fixtures live in `fixtures/`; spec says the stub exists only in test fixtures. Data-driven failure keeps watcher tests realistic (a file change causes the failure, another fixes it).
- **Alternatives**: Stub inside `tests/` (contradicts the fixtures convention); a stub with mutable flags (tests would not exercise real file changes).

## 8. Keeping core framework-free, mechanically

- **Decision**: `tests/core-agnostic.test.ts` reads every file under `src/core/` and fails if it contains (case-insensitive) `spec kit`, `speckit`, `spec-kit`, `openspec`, `bmad` or `.specify`.
- **Rationale**: Turns FR-009 and Principle IV into a check that runs with `bun run verify`.
