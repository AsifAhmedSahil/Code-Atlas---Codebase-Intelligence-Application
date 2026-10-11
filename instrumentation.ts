/*
 * register() runs once when a new server instance starts, before any request
 * is handled. This is where a missing environment variable should stop the
 * process rather than surface as a confusing failure on a later screen.
 */
export async function register(): Promise<void> {
  const { assertServerEnv } = await import("@/lib/env");
  assertServerEnv();
}
