import { auth } from "@clerk/nextjs/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabasePublicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/*
 * The database client carries the signed-in token. Clerk is the only session
 * system: the Supabase client never refreshes or stores a session of its own,
 * it asks Clerk for the current session token on each request. That is what
 * makes the organization claim readable inside a row-level policy later.
 *
 * Nothing queries anything yet. A client wired up anonymously would look
 * completely fine until the first policy exists, and then return nothing.
 */
export function createServerSupabaseClient(): SupabaseClient<Database> {
  const { url, publishableKey } = supabasePublicEnv();

  return createClient<Database>(url, publishableKey, {
    async accessToken() {
      return (await auth()).getToken();
    },
  });
}
