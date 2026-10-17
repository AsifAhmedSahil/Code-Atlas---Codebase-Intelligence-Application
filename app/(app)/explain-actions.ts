"use server";

// The server actions behind the Explanation tab.
//
// A client component calls with what the reader has selected — a file path or a
// folder id on the map — and gets back the explanation, whether it came from the
// cache, and whether anything about it is stale. There are two entry points and
// one pipeline: `explainSelected` may generate, `restoreExplanation` may not.
// The rows are read with the viewer's own token, so an analysis in another
// organization is not found here, exactly as on the page.

import { auth } from "@clerk/nextjs/server";

import { explainSubject, restoreCachedExplanation, type ExplanationSource } from "@/lib/ai/explain";
import type { ExplanationResult, SubjectKind } from "@/lib/ai/subject";
import { foldMap } from "@/lib/map/fold";
import { getStoredAnalysis } from "@/lib/pipeline/load";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function failure(subjectKind: SubjectKind, subjectId: string, message: string): ExplanationResult {
  return {
    status: "error",
    subjectKind,
    subjectId,
    body: "",
    cached: false,
    model: "",
    tracing: false,
    staleness: { moved: false },
    message,
  };
}

// The guard both actions share: signed in, and an analysis that actually has a
// finished map to explain. Nothing below this line can reach another
// organization's rows, because the client carries the viewer's token.
async function loadExplanationSource(
  analysisId: string,
): Promise<{ source: ExplanationSource } | { failed: string }> {
  const { orgId } = await auth();
  if (!orgId) {
    return { failed: "Choose a workspace first." };
  }

  const analysis = await getStoredAnalysis(createServerSupabaseClient(), analysisId);
  if (!analysis || analysis.status !== "complete" || !analysis.result || !analysis.repoUrl) {
    return { failed: "That analysis has no finished map to explain." };
  }

  return {
    source: {
      analysisId: analysis.id,
      organizationId: orgId,
      repoUrl: analysis.repoUrl,
      commitSha: analysis.commitSha,
      result: analysis.result,
      map: foldMap(analysis.result),
    },
  };
}

export async function explainSelected(
  analysisId: string,
  subjectKind: SubjectKind,
  subjectId: string,
): Promise<ExplanationResult> {
  const outcome = await loadExplanationSource(analysisId);
  if ("failed" in outcome) return failure(subjectKind, subjectId, outcome.failed);

  return explainSubject(createServerSupabaseClient(), outcome.source, subjectKind, subjectId);
}

// What the tab asks for when a subject is selected or the page is reloaded:
// the stored answer, if this analysis has one. Returning `null` is a normal
// answer — "nothing stored" — not a failure, and it never spends a model call.
export async function restoreExplanation(
  analysisId: string,
  subjectKind: SubjectKind,
  subjectId: string,
): Promise<ExplanationResult | null> {
  const outcome = await loadExplanationSource(analysisId);
  if ("failed" in outcome) return failure(subjectKind, subjectId, outcome.failed);

  return restoreCachedExplanation(
    createServerSupabaseClient(),
    outcome.source,
    subjectKind,
    subjectId,
  );
}
