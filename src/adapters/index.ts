import type { Adapter } from "../core/adapter";
import { speckitAdapter } from "./speckit";

// Registration order breaks detection ties.
export const adapters: Adapter[] = [speckitAdapter];
