# Contract: Live Check

`scripts/live-check.ts`, exposed as `"live-check": "bun scripts/live-check.ts"` in `package.json`.

```text
bun run live-check [repo-path]
```

- `repo-path` defaults to the repository containing the script (`path.resolve(import.meta.dir, "..")`).
- Steps: `resolveRoots(repoPath)`, then `scan(speckitAdapter, { roots })` from `src/core/scan.ts`.
- Output on success (stdout), one line per root, then per spec, then per issue:

```text
root  /Users/me/Sites/agent-visualizer  (003-speckit-adapter)
root  /Users/me/Sites/agent-visualizer-planner  (detached)
001  done         Server Skeleton  [/Users/me/Sites/agent-visualizer]
002  done         Common Spec Model and Adapter Contract  [/Users/me/Sites/agent-visualizer]
003  planned      Spec Kit Adapter  [/Users/me/Sites/agent-visualizer, 003-speckit-adapter]
issue  missing-title  ...message...
```

  Status is padded to 11 characters. The bracket shows `source.root` and, when present, `source.branch`.
- Exit code 0 when the scan succeeds (issues do not change it); 1 with `Scan failed (<stage>): <message>` on stderr when it fails.
- Read-only: it runs the same code as the adapter and writes nothing.
- Not run by `bun test` or `bun run verify`.
