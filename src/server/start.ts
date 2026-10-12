import { createHandler } from "./routes.js";
import { parseCliArgs } from "./args.js";

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  const handler = await createHandler(args.path);

  // In a real implementation, this would start the server
  console.log(`Starting server for repository: ${args.path}`);
  console.log(`Listening on port ${args.port}`);

  // For now, we just return the handler
  return handler;
}

// If this file is run directly, execute main
if (import.meta.main) {
  main().catch(console.error);
}

export { main };