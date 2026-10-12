import { resolveRepoPath } from "./repo.js";
import { AppError } from "./errors.js";

export async function createHandler(repoPath: string) {
  const repo = await resolveRepoPath(repoPath);

  return async (req: Request): Promise<Response> => {
    // For now, we'll just return a simple response
    return new Response(`Repository: ${repo.name}`, {
      headers: { "Content-Type": "text/plain" }
    });
  };
}