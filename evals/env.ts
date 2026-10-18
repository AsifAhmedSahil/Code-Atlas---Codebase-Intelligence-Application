// The environment the eval scripts run in.
//
// The eval scripts are plain Node programs, not the web app, so nothing has
// loaded `.env.local` for them. This loads it with the runtime's own reader
// (`process.loadEnvFile`, Node 20.12+), so no separate dotenv package is
// needed, then hands back a Supabase client built with the service-role key.
//
// The service-role key, not the publishable key, because the evals read rows
// (explanations, files, roles) across whatever organisation produced the
// analyses they were pointed at, and those reads have to pass row-level
// security. The key never leaves this process; scripts only read.

import { existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";

// Reads `.env.local` from the repository root into `process.env`. Silent when
// the file is absent so a caller that has already exported the variables still
// runs. Existing variables are not overwritten.
export function loadEvalsEnv(file = ".env.local"): void {
  const resolved = path.resolve(process.cwd(), file);
  if (!existsSync(resolved)) return;
  process.loadEnvFile(resolved);
}

// A variable the eval cannot run without. Named in the error so the fix is
// obvious: add it to `.env.local`.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is not set. Add it to .env.local (see the phase 11 notes).`);
  }
  return value;
}

// A Supabase client that bypasses row-level security, for reading the analyses
// and explanations the dataset is drawn from.
export function evalSupabaseClient(): SupabaseClient<Database> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secret = requireEnv("SUPABASE_SECRET_KEY");
  return createClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
