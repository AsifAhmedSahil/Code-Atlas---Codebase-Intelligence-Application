// Starting a run for one analysis.
//
// Two things happen here, and they happen in this order for a reason. The row is
// first *claimed* — moved from `queued` to `running` by a single conditional
// update — so that two tabs opening the same analysis at once cannot both run it:
// the second update matches no row and starts nothing. Only the request that won
// the claim schedules the pipeline.
//
// The pipeline itself runs after this response is sent (`after`), so the caller
// returns immediately and the progress page keeps its subscription open while
// the stages arrive as pushes. A run is never awaited by the browser.
//
// A re-run is the same call with `requeue`: it is only ever a deliberate act,
// made from an analysis that has finished, and it clears that analysis's stored
// rows before the claim so the new result replaces the old in one row.

import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";

import { runAnalysis } from "@/lib/pipeline/run";
import { clearAnalysisResults } from "@/lib/pipeline/requeue";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: "Choose a workspace first." }, { status: 401 });
  }

  const { id } = await params;

  let requeue = false;
  try {
    const body: unknown = await request.json();
    requeue =
      typeof body === "object" &&
      body !== null &&
      (body as { requeue?: unknown }).requeue === true;
  } catch {
    // No body means "start it", which is the common case.
  }

  const client = createServerSupabaseClient();

  const { data: analysis, error: readError } = await client
    .from("analyses")
    .select("id, status, projects ( repo_url )")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    return Response.json({ error: readError.message }, { status: 500 });
  }
  if (!analysis) {
    return Response.json({ error: "That analysis does not exist." }, { status: 404 });
  }
  const url = analysis.projects?.repo_url;
  if (!url) {
    return Response.json({ error: "That analysis has no repository." }, { status: 409 });
  }

  const now = new Date().toISOString();

  if (requeue) {
    // Only a finished analysis may be reset; a running one is left alone. Roles
    // and routes clear with the files so the new result replaces the old whole.
    await clearAnalysisResults(client, id);
    await client
      .from("analyses")
      .update({
        status: "queued",
        stage: null,
        stage_message: null,
        error: null,
        error_stage: null,
        started_at: null,
        finished_at: null,
        updated_at: now,
      })
      .eq("id", id)
      .in("status", ["complete", "failed"]);
  }

  // The claim. This is what makes the run single-owner.
  const { data: claimed, error: claimError } = await client
    .from("analyses")
    .update({
      status: "running",
      stage: "fetch",
      stage_message: "Fetching the repository",
      started_at: now,
      error: null,
      error_stage: null,
      finished_at: null,
      updated_at: now,
    })
    .eq("id", id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (claimError) {
    return Response.json({ error: claimError.message }, { status: 500 });
  }
  if (!claimed) {
    // Someone else already claimed it; there is nothing to start here.
    return Response.json({ started: false });
  }

  after(async () => {
    try {
      await runAnalysis({ url, organizationId: orgId, analysisId: id, client });
    } catch {
      // runAnalysis records the failed state and the stage it failed in before
      // it rethrows; the page reads that. Nothing to do with the throw here.
    }
  });

  return Response.json({ started: true });
}
