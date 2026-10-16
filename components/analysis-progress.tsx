"use client";

// What a run in progress looks like: the four stages, the one it is on lit, and
// the sentence the database published for it. When the run fails it says which
// stage failed and why, and offers a re-run — which is the only way to run the
// same repository a second time.
//
// The page is opened before the run starts. This subscribes first, and only
// once the subscription is live does it ask the server to start the run, so the
// earliest stages are not published into a room with nobody in it.

import { useEffect, useRef, useState } from "react";

import { useAnalysisProgress } from "./use-analysis-progress";

const STAGES = [
  { name: "fetch", label: "Fetch", hint: "Downloading the repository archive" },
  { name: "select", label: "Select", hint: "Unpacking what was downloaded" },
  { name: "parse", label: "Parse", hint: "Reading files and imports" },
  { name: "store", label: "Store", hint: "Saving the map" },
] as const;

type StageState = "done" | "active" | "pending" | "failed";

function dotClass(state: StageState): string {
  if (state === "done") return "bg-incoming";
  if (state === "active") return "bg-accent";
  if (state === "failed") return "bg-outgoing";
  return "bg-border";
}

function textClass(state: StageState): string {
  if (state === "done") return "text-text";
  if (state === "active") return "text-accent";
  if (state === "failed") return "text-outgoing";
  return "text-muted";
}

function stageLabel(name: string | null): string {
  return STAGES.find((stage) => stage.name === name)?.label ?? "the run";
}

// How long to give the progress subscription to connect before starting a run
// without it. Generous enough for a socket to open, short enough that a run is
// not left waiting on a channel that will never join.
const START_FALLBACK_MS = 1200;

export function AnalysisProgress({
  analysisId,
  initialStage,
  initialMessage,
  initialStatus,
  error,
  errorStage,
}: {
  analysisId: string;
  initialStage: string | null;
  initialMessage: string | null;
  initialStatus: string;
  error: string | null;
  errorStage: string | null;
}) {
  const { progress, subscribed } = useAnalysisProgress(analysisId, {
    stage: initialStage,
    message: initialMessage,
    status: initialStatus,
  });

  // Start the run once the subscription is live, and only if this page was
  // opened onto a run that has not started. Waiting for the socket means the
  // first stages are published into a room that already has someone in it.
  //
  // But the run must not depend on the socket. If the channel cannot be joined
  // — a private subscription that the server refuses — waiting forever would
  // leave the run queued and never started. So after a short grace period the
  // run starts anyway; the page still reaches its final state from the server,
  // it just does not tick on the way there.
  const startedRef = useRef(false);
  useEffect(() => {
    if (initialStatus !== "queued" || startedRef.current) return;

    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      void fetch(`/api/analyses/${analysisId}/run`, { method: "POST" });
    };

    if (subscribed) {
      start();
      return;
    }
    const timer = setTimeout(start, START_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [subscribed, initialStatus, analysisId]);

  const [rerunning, setRerunning] = useState(false);
  const rerun = () => {
    if (rerunning) return;
    setRerunning(true);
    void fetch(`/api/analyses/${analysisId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requeue: true }),
    }).finally(() => setRerunning(false));
  };

  const failed = progress.status === "failed";
  const failedStage = errorStage ?? progress.stage;
  const failedIndex = failedStage
    ? STAGES.findIndex((stage) => stage.name === failedStage)
    : -1;
  const currentIndex = progress.stage
    ? STAGES.findIndex((stage) => stage.name === progress.stage)
    : -1;

  const stateOf = (index: number): StageState => {
    if (failed) {
      if (index < failedIndex) return "done";
      if (index === failedIndex) return "failed";
      return "pending";
    }
    if (index < currentIndex) return "done";
    if (index === currentIndex) return "active";
    return "pending";
  };

  const headline = failed
    ? `Failed during ${stageLabel(failedStage)}`
    : progress.message ?? (initialStatus === "queued" ? "Waiting to start…" : "Working…");

  return (
    <div className="flex max-w-[60ch] flex-col">
      <p className="text-[13px] text-muted">
        {failed
          ? "This run stopped and said why."
          : "This run is being watched live. The stage below moves as the database publishes it."}
      </p>

      <p
        className={`mt-4 text-[15px] ${failed ? "text-outgoing" : "text-text"}`}
        aria-live="polite"
      >
        {headline}
      </p>

      <ol className="mt-6 flex flex-col">
        {STAGES.map((stage, index) => {
          const state = stateOf(index);
          const showMessage = state === "active" && progress.message;
          return (
            <li key={stage.name} className="grid grid-cols-[1rem_1fr] gap-x-4">
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1.5 size-2 rounded-full ${dotClass(state)} ${
                    state === "active" ? "animate-pulse" : ""
                  }`}
                  aria-hidden
                />
                {index < STAGES.length - 1 ? (
                  <span className="w-px flex-1 bg-border" aria-hidden />
                ) : null}
              </div>
              <div className="pb-6">
                <p className={`text-[13px] ${textClass(state)}`}>{stage.label}</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {showMessage ? progress.message : stage.hint}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {failed && (
        <div className="mt-2 rounded-lg border border-border bg-raised p-4">
          <p className="text-[12px] text-muted">
            The reason, as recorded:
          </p>
          <p className="mt-1 font-mono text-[12px] leading-relaxed text-text">
            {error ?? "No reason was recorded for this run."}
          </p>
          <button
            type="button"
            onClick={rerun}
            disabled={rerunning}
            className="mt-4 h-9 rounded-md bg-accent px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            {rerunning ? "Starting…" : "Run again"}
          </button>
        </div>
      )}
    </div>
  );
}
