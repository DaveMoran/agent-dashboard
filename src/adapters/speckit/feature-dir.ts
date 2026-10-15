export const FEATURE_DIR_RE = /^(\d{3,})-(.+)$/;

export interface FeatureCopy {
  root: string;
  dirName: string;
  id: string;
  /** Paths relative to root, "/"-separated, sorted. */
  files: string[];
}

export function parseFeatureDirName(name: string): { id: string; dirName: string } | null {
  const m = FEATURE_DIR_RE.exec(name);
  return m ? { id: m[1]!, dirName: name } : null;
}

/** Group files into one copy per (root, feature directory); drops groups without spec.md. */
export function groupFeatureFiles(roots: string[], absFiles: string[]): FeatureCopy[] {
  const groups = new Map<string, FeatureCopy>();

  for (const file of absFiles) {
    let rootIndex = -1;
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i]!;
      if (file.startsWith(r + "/") && (rootIndex < 0 || r.length > roots[rootIndex]!.length)) {
        rootIndex = i;
      }
    }
    if (rootIndex < 0) continue;

    const rel = file.slice(roots[rootIndex]!.length + 1);
    const parts = rel.split("/");
    if (parts.length < 3 || parts[0] !== "specs") continue;
    const parsed = parseFeatureDirName(parts[1]!);
    if (!parsed) continue;

    const key = `${rootIndex}\0${parsed.dirName}`;
    let copy = groups.get(key);
    if (!copy) {
      copy = { root: roots[rootIndex]!, dirName: parsed.dirName, id: parsed.id, files: [] };
      groups.set(key, copy);
    }
    copy.files.push(rel);
  }

  const order = (c: FeatureCopy) => roots.indexOf(c.root);
  return [...groups.values()]
    .filter((c) => c.files.includes(`specs/${c.dirName}/spec.md`))
    .map((c) => ({ ...c, files: [...c.files].sort() }))
    .sort((a, b) => order(a) - order(b) || (a.dirName < b.dirName ? -1 : a.dirName > b.dirName ? 1 : 0));
}
