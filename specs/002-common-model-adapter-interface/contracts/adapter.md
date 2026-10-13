# Contract: Adapter Interface

Defined in `src/core/adapter.ts`. Adapters are registered in `src/adapters/index.ts` (production) or built ad hoc in tests.

```ts
interface RepoContext {
  roots: string[];          // absolute real paths, >= 1; roots[0] is the path the user gave
}

interface WatchTarget {
  root: string;             // one of ctx.roots
  patterns: string[];       // globs relative to root, e.g. "specs/*/spec.md"
}

interface Adapter {
  name: string;             // unique, stable, lowercase-kebab; used by the "adapter" config key
  detect(ctx: RepoContext): Promise<boolean>;
  discover(ctx: RepoContext): Promise<WatchTarget[]>;
  parse(ctx: RepoContext, files: string[]): Promise<unknown[]>;
}
```

## Semantics

- **detect** returns true when the framework is present in any root. It must be fast and read-only. If it throws, the registry treats the adapter as not matching and records a `detect-failed` issue.
- **discover** returns patterns per root. Patterns are matched with `Bun.Glob` against paths relative to the root, using `/` separators. Paths under `.git/` and `node_modules/` are never matched. Returning `[]` is valid (nothing to watch).
- **parse** receives the absolute paths of every file that matched, sorted, across all roots, and returns raw spec objects in the shape of `Spec` (see data-model). The core validates them; adapters should set `source.root` for each spec. Throwing means the scan failed: the watcher emits an error and keeps the last good snapshot.
- Adapters must not write anywhere. Adapters must not import from `src/server/` or `src/cli/`.

## Registry

```ts
function createRegistry(adapters: Adapter[]): Registry;   // throws on duplicate names (programming error)
function selectAdapter(registry: Registry, ctx: RepoContext, forced?: string): Promise<Selection>;
function assertKnownAdapter(name: string | undefined, registry: Registry): void; // throws UnknownAdapterError
```

- Detection runs every adapter's `detect` in registration order; `matched` lists all that returned true; the first is selected.
- `forced` set and registered: that adapter is selected; if its `detect` is false, `warnings` includes `Adapter "<name>" did not recognize this repo`.
- `forced` set and not registered: `UnknownAdapterError` (exit code 1) with message `Unknown adapter "<name>". Available adapters: <a, b>` or `Available adapters: none registered`.
- No match and not forced: `adapter: null`, which callers treat as an empty snapshot.
