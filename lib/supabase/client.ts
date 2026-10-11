"use client";

import { useSession } from "@clerk/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useMemo } from "react";

import { supabasePublicEnv } from "@/lib/env";

/*
 * Browser-side counterpart to the server client. Same rule: Clerk owns the
 * session, Supabase only borrows the token for the length of a request.
 */
export function useSupabaseClient(): SupabaseClient {
  const { session } = useSession();

  return useMemo(() => {
    const { url, publishableKey } = supabasePublicEnv();

    return createClient(url, publishableKey, {
      async accessToken() {
        return session?.getToken() ?? null;
      },
    });
  }, [session]);
}
