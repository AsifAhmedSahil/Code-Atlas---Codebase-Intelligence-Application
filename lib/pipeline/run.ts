// The run: fetch, select, parse, store.
//
// Each stage is named and written to the row as it begins, so a run that is slow
// is legible and a run that dies has a last-known stage. The catch at the top
// writes a failed state — with the reason and the stage — so a row is never left
// saying "running" forever.

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import { parseRepository } from "@/lib/parser";
import type { Database, Json } from "@/lib/supabase/database.types";
import { classifyUnidentified } from "@/lib/ai/classify";

import { extractArchive, repositoryRoot } from "./archive";
import { downloadArchive, parseRepoUrl, resolveRepository } from "./github";
import { storeAnalysis } from "./store";

export type StageName = "fetch" | "select" | "parse" | "classify" | "store";

export interface RunInput {
  url: string;
  organizationId: string;
  analysisId: string;
  client: SupabaseClient<Database>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runAnalysis(input: RunInput): Promise<void> {
  const { url, organizationId, analysisId, client } = input;
  let stage: StageName = "fetch";
  const stamp = () => new Date().toISOString();

  const advance = async (next: StageName, message: string): Promise<void> => {
    stage = next;
    const { error } = await client
      .from("analyses")
      .update({ status: "running", stage: next, stage_message: message, updated_at: stamp() })
      .eq("id", analysisId);
    if (error) throw new Error(`Could not record progress: ${error.message}`);
  };

  const workDir = await fs.mkdtemp(path.join(tmpdir(), "reposcope-"));
  try {
    await advance("fetch", "Fetching the repository");
    const remote = await resolveRepository(parseRepoUrl(url));
    const archivePath = path.join(workDir, "repository.tar.gz");
    await downloadArchive(remote, archivePath);

    await advance("select", "Unpacking the archive");
    const extractionDir = path.join(workDir, "extracted");
    await extractArchive(archivePath, extractionDir);
    const root = await repositoryRoot(extractionDir);

    await advance("parse", "Reading files and imports");
    const parsed = await parseRepository(root);

    // A stage between parsing and storing: files no adapter could place are
    // asked about, one word each, and left alone if anything goes wrong. It is
    // best-effort by design, so a repository with nothing unclassified pays for
    // no call at all.
    await advance("classify", "Identifying files no rule recognised");
    const result = await classifyUnidentified({ root, result: parsed });

    await advance("store", "Saving the map");
    await storeAnalysis(client, { organizationId, analysisId, result });

    const { error } = await client
      .from("analyses")
      .update({
        status: "complete",
        stage: null,
        stage_message: null,
        finished_at: stamp(),
        updated_at: stamp(),
        commit_sha: remote.commitSha,
        adapter: result.adapter,
        root: result.root,
        counts: result.counts as unknown as Json,
        coverage: result.coverage as unknown as Json,
      })
      .eq("id", analysisId);
    if (error) throw new Error(`Could not finish the analysis: ${error.message}`);
  } catch (error) {
    await client
      .from("analyses")
      .update({
        status: "failed",
        error: messageOf(error),
        error_stage: stage,
        finished_at: stamp(),
        updated_at: stamp(),
      })
      .eq("id", analysisId);
    throw error;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
