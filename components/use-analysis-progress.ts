"use client";

// Subscribing to one run's progress channel.
//
// The stage and its message are pushed by the database, not fetched on a timer:
// this opens one socket to a channel named for the run and re-renders whatever
// arrives. The browser uses the authenticated client, so the socket carries the
// session token — which is why the channel can be private and the policy can
// name who may join it.
//
// Clerk session tokens are short-lived, so the token is also re-set on the
// socket periodically. That keeps the connection authorized during a long run;
// it is about the socket's credentials, not about polling for progress.

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useSupabaseClient } from "@/lib/supabase/client";

export type LiveProgress = {
  stage: string | null;
  message: string | null;
  status: string;
};

export interface ProgressSnapshot {
  progress: LiveProgress;
  subscribed: boolean;
}

const AUTH_REFRESH_MS = 30_000;

export function useAnalysisProgress(
  analysisId: string,
  initial: LiveProgress,
): ProgressSnapshot {
  const supabase = useSupabaseClient();
  const { getToken } = useAuth();
  const router = useRouter();
  const [progress, setProgress] = useState<LiveProgress>(initial);
  const [subscribed, setSubscribed] = useState(false);

  // Read through refs so a new function identity from Clerk does not tear down
  // and rebuild the socket on every render.
  const getTokenRef = useRef(getToken);
  const routerRef = useRef(router);
  useEffect(() => {
    getTokenRef.current = getToken;
    routerRef.current = router;
  }, [getToken, router]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let stopped = false;

    const authorize = async () => {
      const token = await getTokenRef.current();
      if (stopped || !token) return;
      await supabase.realtime.setAuth(token);
    };

    const start = async () => {
      await authorize();
      if (stopped) return;

      channel = supabase.channel(`analysis:${analysisId}`, {
        config: { private: true },
      });
      channel
        .on("broadcast", { event: "progress" }, (message) => {
          const payload = (message as { payload?: LiveProgress }).payload;
          if (!payload) return;
          setProgress(payload);
          if (payload.status === "complete" || payload.status === "failed") {
            routerRef.current.refresh();
          }
        })
        .subscribe((status) => {
          if (!stopped) setSubscribed(String(status) === "SUBSCRIBED");
        });
    };

    void start();
    const timer = setInterval(() => {
      void authorize();
    }, AUTH_REFRESH_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [analysisId, supabase]);

  return { progress, subscribed };
}
