// The dashboard form's endpoint: claim a repository and hand back the analysis
// to watch.
//
// Nothing is parsed here. A new repository gets one analysis row in the
// `queued` state and the caller is sent to its page, which claims and runs it.
// A repository that has already been analysed is not analysed again: submitting
// its URL returns the analysis that exists, which is the whole of "one analysis
// per repository". Re-running is a deliberate act from that analysis, never a
// side effect of pasting the same URL twice.

import { auth } from "@clerk/nextjs/server";

import { parseRepoUrl } from "@/lib/pipeline/github";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// owner/repo canonicalised out of any github.com URL. A URL that is not a
// github.com repository is refused here, before any row is written.
function canonicalRepoUrl(input: string): string {
  const ref = parseRepoUrl(input);
  return `https://github.com/${ref.owner}/${ref.repo}`;
}

export async function POST(request: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: "Choose a workspace first." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body with a `url`." }, { status: 400 });
  }
  const rawUrl =
    typeof body === "object" && body !== null && "url" in body
      ? (body as { url?: unknown }).url
      : undefined;
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return Response.json({ error: "A repository URL is required." }, { status: 400 });
  }

  let repoUrl: string;
  try {
    repoUrl = canonicalRepoUrl(rawUrl);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  const client = createServerSupabaseClient();

  const { data: project, error: projectError } = await client
    .from("projects")
    .upsert(
      { organization_id: orgId, name: repoUrl.split("/").pop() ?? repoUrl, repo_url: repoUrl },
      { onConflict: "organization_id,repo_url" },
    )
    .select()
    .single();
  if (projectError || !project) {
    return Response.json(
      { error: `Could not record the project: ${projectError?.message ?? "unknown error"}` },
      { status: 500 },
    );
  }

  const { data: existing, error: existingError } = await client
    .from("analyses")
    .select("id, status")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    return Response.json({ error: existingError.message }, { status: 500 });
  }
  if (existing) {
    return Response.json({ id: existing.id, status: existing.status, existing: true });
  }

  const { data: analysis, error: analysisError } = await client
    .from("analyses")
    .insert({
      organization_id: orgId,
      project_id: project.id,
      status: "queued",
    })
    .select("id, status")
    .single();
  if (analysisError || !analysis) {
    return Response.json(
      { error: `Could not start the analysis: ${analysisError?.message ?? "unknown error"}` },
      { status: 500 },
    );
  }

  return Response.json({ id: analysis.id, status: analysis.status, existing: false }, { status: 201 });
}
