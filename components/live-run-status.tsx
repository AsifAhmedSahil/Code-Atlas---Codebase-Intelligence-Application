"use client";

// One row's status on the dashboard, kept live while the run is in progress.
//
// A run that has finished is rendered by the server and never subscribes — only
// a run that is still going opens a socket, and it closes the moment the run
// reports it is done.

import { useAnalysisProgress } from "./use-analysis-progress";

const STATUS_WORD: Record<string, string> = {
  complete: "text-incoming",
  running: "text-accent",
  queued: "text-muted",
  failed: "text-outgoing",
};

const STATUS_NODE: Record<string, string> = {
  complete: "bg-incoming",
  running: "bg-accent",
  queued: "bg-muted",
  failed: "bg-outgoing",
};

export function LiveRunStatus({
  analysisId,
  status,
  stageMessage,
}: {
  analysisId: string;
  status: string;
  stageMessage: string | null;
}) {
  const { progress } = useAnalysisProgress(analysisId, {
    stage: null,
    message: stageMessage,
    status,
  });

  const word = STATUS_WORD[progress.status] ?? "text-muted";
  const node = STATUS_NODE[progress.status] ?? "bg-muted";
  const running = progress.status === "running";

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className={`flex items-center gap-1.5 text-[12px] ${word}`}>
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${node} ${running ? "animate-pulse" : ""}`}
        />
        {progress.status}
      </span>
      {running && progress.message ? (
        <span className="max-w-[30ch] truncate text-[11px] text-muted">
          {progress.message}
        </span>
      ) : null}
    </div>
  );
}
