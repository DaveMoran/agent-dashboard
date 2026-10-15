import path from "node:path";
import { speckitAdapter } from "../src/adapters/speckit";
import { scan } from "../src/core/scan";
import { currentBranch, resolveRoots } from "../src/git/worktrees";

const repoPath = path.resolve(process.argv[2] ?? path.resolve(import.meta.dir, ".."));
const roots = await resolveRoots(repoPath);
const result = await scan(speckitAdapter, { roots });

if (!result.ok) {
  console.error(`Scan failed (${result.error.stage}): ${result.error.message}`);
  process.exit(1);
}

for (const root of roots) {
  console.log(`root  ${root}  (${(await currentBranch(root)) ?? "detached"})`);
}
for (const spec of result.snapshot.specs) {
  const source = spec.source ? [spec.source.root, spec.source.branch].filter(Boolean).join(", ") : "";
  console.log(`${spec.id}  ${spec.status.padEnd(11)}  ${spec.title}  [${source}]`);
}
for (const issue of result.snapshot.issues) {
  console.log(`issue  ${issue.kind}  ${issue.message}`);
}
