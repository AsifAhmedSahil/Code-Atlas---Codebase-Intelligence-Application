// Generate real explanations for files of the seeded analysis, through the
// product's own explain pipeline (lib/ai/explain), so the invented-path check
// has a representative sample of recent real traffic to run against.
//
// Nothing here invents an answer: every row is produced by `explainSubject`,
// which reads the cache, fetches the file at the analysed commit, builds the
// real prompt and writes the cache. If a subject is already cached it is reused
// without a model call.
//
// Run detached, e.g.:
//   cmd /c "npx tsx scripts/seed-explanations.ts > seed.out 2>&1"

import type { SupabaseClient } from "@supabase/supabase-js";

import { explainSubject, type ExplanationSource } from "../lib/ai/explain";
import { fileNeighbourhood, roleByPath } from "../lib/ai/context";
import { foldMap } from "../lib/map/fold";
import { getStoredAnalysis } from "../lib/pipeline/load";
import type { Database } from "../lib/supabase/database.types";

import { evalSupabaseClient, loadEvalsEnv } from "../evals/env";

// How many subjects to explain. Bounded so the run finishes in one sitting.
const LIMIT = 24;

async function buildSource(
  client: SupabaseClient<Database>,
  analysisId: string,
): Promise<ExplanationSource | null> {
  const stored = await getStoredAnalysis(client, analysisId);
  if (stored === null || stored.result === null) return null;
  if (stored.repoUrl === null || stored.commitSha === null) return null;

  const { data, error } = await client
    .from("analyses")
    .select("organization_id")
    .eq("id", analysisId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data === null) return null;

  return {
    analysisId,
    organizationId: data.organization_id,
    repoUrl: stored.repoUrl,
    commitSha: stored.commitSha,
    result: stored.result,
    map: foldMap(stored.result),
  };
}

async function main(): Promise<void> {
  loadEvalsEnv();
  const client = evalSupabaseClient();

  // The completed analysis with the most files that have a neighbour, so the
  // explanations describe files that sit inside a real import graph.
  const { data, error } = await client
    .from("analyses")
    .select("id")
    .eq("status", "complete")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  let analysisId: string | null = null;
  let bestPaths: string[] = [];
  let storedResult: Awaited<ReturnType<typeof getStoredAnalysis>> = null;
  for (const row of data ?? []) {
    const stored = await getStoredAnalysis(client, row.id);
    if (stored === null || stored.result === null) continue;
    if (stored.repoUrl === null || stored.commitSha === null) continue;
    const roles = roleByPath(stored.result);
    const paths = stored.result.files
      .map((file) => file.path)
      .filter((path) => {
        const nb = fileNeighbourhood(stored.result!, path, roles);
        return nb.dependencies.length + nb.dependents.length > 0;
      })
      .sort((a, b) => a.localeCompare(b));
    if (paths.length > bestPaths.length) {
      analysisId = row.id;
      bestPaths = paths;
      storedResult = stored;
    }
  }

  if (analysisId === null || storedResult === null) {
    throw new Error("No complete analysis with neighbour-connected files was found.");
  }
  console.log(`analysis ${analysisId} with ${bestPaths.length} connected files`);

  const source = await buildSource(client, analysisId);
  if (source === null) throw new Error("Could not rebuild the analysis for explanation.");

  // Spread the sample across the whole file list rather than taking a prefix,
  // so the answers cover different folders instead of one alphabetical run.
  const stride = Math.max(1, Math.floor(bestPaths.length / LIMIT));
  const chosen: string[] = [];
  for (let i = 0; i < bestPaths.length && chosen.length < LIMIT; i += stride) {
    chosen.push(bestPaths[i]);
  }

  let ok = 0;
  let cached = 0;
  let failed = 0;
  for (const path of chosen) {
    try {
      const result = await explainSubject(client, source, "file", path);
      if (result.status === "ok") {
        ok += 1;
        if (result.cached) cached += 1;
        console.log(`  ok${result.cached ? " (cached)" : ""}  ${path}`);
      } else {
        failed += 1;
        console.log(`  fail  ${path}  ${result.message ?? ""}`);
      }
    } catch (e) {
      failed += 1;
      console.log(`  fail  ${path}  ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`explained ${ok} subject(s) (${cached} from cache), ${failed} failed`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
