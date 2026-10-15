import type { FeatureCopy } from "./feature-dir";

/** The copy in the root whose checked-out branch is the feature's branch, else the first root's copy. */
export function pickAuthoritative(
  copies: FeatureCopy[],
  rootBranches: Map<string, string | null>,
  roots: string[],
): FeatureCopy {
  const byRootOrder = [...copies].sort((a, b) => roots.indexOf(a.root) - roots.indexOf(b.root));
  return byRootOrder.find((c) => rootBranches.get(c.root) === c.dirName) ?? byRootOrder[0]!;
}
