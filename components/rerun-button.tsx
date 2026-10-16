"use client";

// Re-running a finished analysis, from the analysis itself.
//
// A repository is only ever analysed once; asking for it again from the
// dashboard returns what exists. This button is the other half of that rule —
// the deliberate act: it re-queues this one row, clearing its stored rows first,
// and then refreshes so the page picks up the fresh run and its live rail.

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RerunButton({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const rerun = () => {
    if (pending) return;
    setPending(true);
    void fetch(`/api/analyses/${analysisId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requeue: true }),
    })
      .catch(() => {})
      .finally(() => {
        // The run has been re-queued and claimed; rendering again shows the
        // progress rail rather than the finished map.
        router.refresh();
        setPending(false);
      });
  };

  return (
    <button
      type="button"
      onClick={rerun}
      disabled={pending}
      className="h-7 shrink-0 rounded-md border border-border px-2.5 text-[11px] text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
    >
      {pending ? "Starting…" : "Run again"}
    </button>
  );
}
