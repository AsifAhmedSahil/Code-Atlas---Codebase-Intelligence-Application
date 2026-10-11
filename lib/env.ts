/*
 * Environment configuration fails loudly at startup if it is missing. A blank
 * value that produces a confusing error three screens later is worse than a
 * crash on boot, so every required variable is checked by exact name.
 */
export const REQUIRED_ENV = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

export type RequiredEnvName = (typeof REQUIRED_ENV)[number];

export function assertServerEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Set them in .env.local before starting the server.`
    );
  }
}

export function supabasePublicEnv(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase public environment variables are not configured."
    );
  }
  return { url, publishableKey };
}
