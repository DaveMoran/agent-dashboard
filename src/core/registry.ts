import { AppError } from "../server/errors";
import type { Adapter, RepoContext } from "./adapter";
import type { Issue } from "./model";

export interface Registry {
  adapters: readonly Adapter[];
}

export interface Selection {
  adapter: Adapter | null;
  matched: string[];
  forced: boolean;
  warnings: string[];
  issues: Issue[];
}

export class UnknownAdapterError extends AppError {
  constructor(name: string, registry: Registry) {
    const names = registry.adapters.map((a) => a.name);
    const available = names.length > 0 ? names.join(", ") : "none registered";
    super(`Unknown adapter "${name}". Available adapters: ${available}`);
  }
}

export function createRegistry(adapters: Adapter[]): Registry {
  const seen = new Set<string>();
  for (const adapter of adapters) {
    if (seen.has(adapter.name)) {
      throw new Error(`Duplicate adapter name "${adapter.name}"`);
    }
    seen.add(adapter.name);
  }
  return { adapters: [...adapters] };
}

export function assertKnownAdapter(name: string | undefined, registry: Registry): void {
  if (name === undefined) return;
  if (!registry.adapters.some((a) => a.name === name)) {
    throw new UnknownAdapterError(name, registry);
  }
}

export async function selectAdapter(
  registry: Registry,
  ctx: RepoContext,
  forced?: string,
): Promise<Selection> {
  assertKnownAdapter(forced, registry);

  const matched: string[] = [];
  const issues: Issue[] = [];
  for (const adapter of registry.adapters) {
    try {
      if (await adapter.detect(ctx)) matched.push(adapter.name);
    } catch (err) {
      issues.push({
        kind: "detect-failed",
        message: `Adapter "${adapter.name}" detect failed: ${err instanceof Error ? err.message : String(err)}`,
        related: [adapter.name],
      });
    }
  }

  const warnings: string[] = [];
  if (forced !== undefined) {
    const adapter = registry.adapters.find((a) => a.name === forced)!;
    if (!matched.includes(forced)) {
      warnings.push(`Adapter "${forced}" did not recognize this repo`);
    }
    return { adapter, matched, forced: true, warnings, issues };
  }

  const first = registry.adapters.find((a) => a.name === matched[0]) ?? null;
  return { adapter: first, matched, forced: false, warnings, issues };
}
