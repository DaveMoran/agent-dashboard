export interface RepoContext {
  /** Absolute real paths, at least one; roots[0] is the path the user gave. */
  roots: string[];
}

export interface WatchTarget {
  /** One of ctx.roots. */
  root: string;
  /** Globs relative to root, e.g. "specs/*/spec.md". */
  patterns: string[];
}

export interface Adapter {
  /** Unique, stable, lowercase-kebab; used by the "adapter" config key. */
  name: string;
  detect(ctx: RepoContext): Promise<boolean>;
  discover(ctx: RepoContext): Promise<WatchTarget[]>;
  parse(ctx: RepoContext, files: string[]): Promise<unknown[]>;
}
