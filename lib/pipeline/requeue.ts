// Clearing one analysis's stored result before a re-run.
//
// Roles and routes hang off files, so they clear first; the deletes are explicit
// rather than left to a cascade so a partial failure is legible and no stale
// role or route can outlive the files it described. Keeping the list here lets
// the re-run path be tested without a live database.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export async function clearAnalysisResults(
  client: SupabaseClient<Database>,
  analysisId: string,
): Promise<void> {
  await client.from("edges").delete().eq("analysis_id", analysisId);
  await client.from("routes").delete().eq("analysis_id", analysisId);
  await client.from("file_roles").delete().eq("analysis_id", analysisId);
  await client.from("files").delete().eq("analysis_id", analysisId);
  await client.from("skipped_files").delete().eq("analysis_id", analysisId);
}
