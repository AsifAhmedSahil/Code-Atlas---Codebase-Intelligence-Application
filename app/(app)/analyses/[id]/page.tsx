import Link from "next/link";
import { notFound } from "next/navigation";

import { AnalysisProgress } from "@/components/analysis-progress";
import { RerunButton } from "@/components/rerun-button";
import { CoverageBanner } from "@/components/workspace/coverage-banner";
import { countCategories } from "@/components/workspace/categories";
import { WorkspaceView } from "@/components/workspace/workspace-view";
import { foldMap } from "@/lib/map/fold";
import { resolveNodeLabels } from "@/lib/map/labels";
import { getStoredAnalysis, type StoredAnalysis } from "@/lib/pipeline/load";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/*
 * One analysis. It is the same address whether the run is queued, going, failed
 * or done: a queued or running run shows the live stage rail, a finished one
 * shows the map built from the stored rows, and a failed one shows why.
 *
 * The rows are read with the viewer's own token, so an analysis in another
 * organization is not visible here at all — the policy decides, and a row that
 * is not returned reads as not found.
 */
export const instant = false;

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const analysis = await getStoredAnalysis(supabase, id);
  if (!analysis) notFound();

  const result = analysis.result;
  if (analysis.status === "complete" && result) {
    const roleByPath = new Map(result.roles.map((entry) => [entry.path, entry.role]));
    const categories = countCategories(result.files, roleByPath, result.adapter);
    const folded = foldMap(result);
    const labels = Object.fromEntries(resolveNodeLabels(folded.nodes, result.root));

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
          <div className="flex min-w-0 items-baseline gap-3">
            <Link
              href="/"
              className="shrink-0 text-[12px] text-accent hover:underline"
            >
              ← Runs
            </Link>
            <span className="truncate font-display text-[13px] font-medium text-text">
              {analysis.projectName}
            </span>
            {analysis.repoUrl ? (
              <span className="hidden truncate font-mono text-[11px] text-muted sm:inline">
                {analysis.repoUrl}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-baseline gap-3 font-mono text-[11px] tabular-nums text-muted">
              <span>{result.counts.parsed.toLocaleString()} files</span>
              <span>{result.edges.length.toLocaleString()} edges</span>
              {analysis.commitSha ? (
                <span title="Commit analysed">{analysis.commitSha.slice(0, 7)}</span>
              ) : null}
            </div>
            <RerunButton analysisId={analysis.id} />
          </div>
        </header>
        <WorkspaceView
          parse={result}
          folded={folded}
          labels={labels}
          categories={categories}
          banner={<CoverageBanner coverage={result.coverage} />}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
      <RunHeading analysis={analysis} />
      <div className="mt-10">
        <AnalysisProgress
          analysisId={analysis.id}
          initialStage={analysis.stage}
          initialMessage={analysis.stageMessage}
          initialStatus={analysis.status}
          error={analysis.error}
          errorStage={analysis.errorStage}
        />
      </div>
    </div>
  );
}

function RunHeading({ analysis }: { analysis: StoredAnalysis }) {
  return (
    <header className="flex flex-col gap-2">
      <Link href="/" className="text-[12px] text-accent hover:underline">
        ← All runs
      </Link>
      <h1 className="font-display text-[1.75rem] leading-tight tracking-[-0.02em] text-text">
        {analysis.projectName}
      </h1>
      {analysis.repoUrl ? (
        <p className="font-mono text-[12px] text-muted">{analysis.repoUrl}</p>
      ) : null}
    </header>
  );
}
