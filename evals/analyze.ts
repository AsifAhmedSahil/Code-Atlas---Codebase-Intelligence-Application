// Seeding the eval dataset: run a repository through the application's own
// pipeline.
//
// The role-accuracy eval needs files whose role a framework assigned by
// convention, and those only exist in the database after a normal analysis. This
// does exactly what the dashboard's POST /api/analyses does — upsert the
// project, insert one queued analysis — and then calls the same `runAnalysis`
// the app calls. No second parser, no second downloader, no second classifier:
// the pipeline is the product's.
//
// It is meant to be pointed at a repository the eval needs more of — a
// component-heavy React tree, or a NestJS tree full of services — to push the
// eligible-file count past the minimum.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseRepoUrl } from "../lib/pipeline/github";
import { runAnalysis } from "../lib/pipeline/run";
import type { Database } from "../lib/supabase/database.types";

export interface SeedResult {
  analysisId: string;
  organizationId: string;
  repoUrl: string;
  // True when the repository already had an analysis; nothing was run again.
  existing: boolean;
}

// The organisation the analyses will belong to. Taken from the caller, or — when
// none is given — read back from the projects already stored, so the eval joins
// the same workspace rather than inventing one.
async function resolveOrganizationId(
  client: SupabaseClient<Database>,
  explicit: string | undefined,
): Promise<string> {
  if (explicit !== undefined && explicit.trim() !== "") return explicit.trim();
  const { data, error } = await client.from("projects").select("organization_id").limit(1000);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.organization_id, (counts.get(row.organization_id) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [org, count] of counts) {
    if (count > bestCount) {
      best = org;
      bestCount = count;
    }
  }
  if (best === null) {
    throw new Error(
      "No existing project names an organisation. Pass one explicitly: " +
        "`npx tsx evals/run.ts analyze <repoUrl> <organizationId>`.",
    );
  }
  return best;
}

export async function seedAnalysis(
  client: SupabaseClient<Database>,
  input: { repoUrl: string; organizationId?: string },
): Promise<SeedResult> {
  const ref = parseRepoUrl(input.repoUrl);
  const repoUrl = `https://github.com/${ref.owner}/${ref.repo}`;
  const organizationId = await resolveOrganizationId(client, input.organizationId);

  const { data: project, error: projectError } = await client
    .from("projects")
    .upsert(
      { organization_id: organizationId, name: ref.repo, repo_url: repoUrl },
      { onConflict: "organization_id,repo_url" },
    )
    .select("id")
    .single();
  if (projectError || !project) {
    throw new Error(`Could not record the project: ${projectError?.message ?? "unknown error"}`);
  }

  const { data: existing, error: existingError } = await client
    .from("analyses")
    .select("id")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    return { analysisId: existing.id, organizationId, repoUrl, existing: true };
  }

  const { data: analysis, error: analysisError } = await client
    .from("analyses")
    .insert({ organization_id: organizationId, project_id: project.id, status: "queued" })
    .select("id")
    .single();
  if (analysisError || !analysis) {
    throw new Error(`Could not start the analysis: ${analysisError?.message ?? "unknown error"}`);
  }

  await runAnalysis({ url: repoUrl, organizationId, analysisId: analysis.id, client });
  return { analysisId: analysis.id, organizationId, repoUrl, existing: false };
}
