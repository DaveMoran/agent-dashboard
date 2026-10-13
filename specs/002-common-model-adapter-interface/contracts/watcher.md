# Contract: Scan and Watcher

Defined in `src/core/scan.ts` and `src/core/watcher.ts`.

## scan

```ts
function scan(adapter: Adapter | null, ctx: RepoContext): Promise<ScanResult>;
type ScanResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; error: { stage: "discover" | "parse"; message: string } };
```

- `adapter === null` returns `{ ok: true, snapshot: { specs: [], issues: [], adapter: null, scannedAt } }`.
- Steps: `discover` -> expand patterns per root (skip `.git/`, `node_modules/`; an unreadable root or directory adds an `unreadable-path` issue and is skipped) -> sort files -> `parse` -> `validateSpecs` -> snapshot.
- `discover` or `parse` throwing returns `ok: false` with the stage and the error message; scan itself never throws.

## watchSpecs

```ts
function watchSpecs(options: {
  adapter: Adapter | null;
  ctx: RepoContext;
  onNotification: (n: Notification) => void;
  debounceMs?: number;   // default 150
  maxWaitMs?: number;    // default 2000
}): Promise<SpecWatcher>;

interface SpecWatcher {
  current(): Snapshot;   // last good snapshot
  stop(): Promise<void>;
}

type Notification =
  | { type: "initial"; snapshot: Snapshot }
  | { type: "spec-changed"; snapshot: Snapshot }
  | { type: "error"; error: { stage: "discover" | "parse"; message: string }; snapshot: Snapshot };
```

## Behavior

1. On start, runs one scan and emits exactly one `initial` (or `error` if the first scan fails, with an empty snapshot) before resolving.
2. Watches every root recursively. An event counts as a change if its path, relative to the root, matches any current pattern for that root, or is a directory (it may contain future matches). Events under `.git/` or `node_modules/` are ignored.
3. The first change starts a quiet timer (`debounceMs`) and a max-wait timer (`maxWaitMs`); each further change restarts only the quiet timer. Whichever fires first triggers a scan.
4. Scans never overlap. Changes during a scan trigger one more scan after it finishes.
5. A successful scan replaces `current()` and emits `spec-changed`, even if nothing differs (consumers may compare). A failed scan emits `error` with the last good snapshot and leaves `current()` unchanged.
6. Patterns are refreshed by every scan, so newly discovered targets are honored without a restart.
7. `stop()` closes all OS watchers, clears timers, waits for an in-flight scan to finish, and guarantees no notification is emitted after it resolves.
8. Nothing is ever written to any root.
