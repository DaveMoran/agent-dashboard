function isAddressInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "EADDRINUSE") return true;
  return typeof message === "string" && (message.includes("EADDRINUSE") || message.includes("in use"));
}

/**
 * Calls `listen(requestedPort)`; if that port is taken, calls `listen(0)` so the OS
 * picks a free one. Any other error is rethrown.
 */
export function listenWithFallback<T>(
  requestedPort: number,
  listen: (port: number) => T,
): { server: T; fellBack: boolean } {
  try {
    return { server: listen(requestedPort), fellBack: false };
  } catch (error) {
    if (!isAddressInUse(error)) throw error;
    return { server: listen(0), fellBack: true };
  }
}
