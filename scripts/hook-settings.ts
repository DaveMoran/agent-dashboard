import path from "node:path";
import { buildHookSettings } from "../src/agents/attention/settings";

const hookScript = path.resolve(import.meta.dir, "..", "hooks", "attention-hook.ts");
console.log(JSON.stringify(buildHookSettings(process.execPath, hookScript), null, 2));
