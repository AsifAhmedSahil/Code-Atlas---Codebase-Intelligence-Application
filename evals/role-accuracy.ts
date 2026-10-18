// Role accuracy: how often does classification agree with the framework's own
// answer, on files that were held out of the prompt?
//
// The ground truth is not a human's opinion and not the model's. It is the role
// an adapter gave a file by convention — a `*.service.ts` in a NestJS tree, a
// `.tsx` in a React tree — read back from the stored analysis. Only roles the
// classifier is allowed to return are kept, and only those an adapter assigned
// (a role the model itself assigned proves nothing here). The file's role is
// withheld from the prompt; the model is asked cold, one word, exactly as the
// classify stage asks; and the answer is compared.
//
// The dataset is assembled across every completed analysis, because no single
// repository the evals have been run against holds thirty such files on its own.
// Before any prediction is asked for, the size is asserted against the minimum
// this phase requires, so a thin dataset fails loudly instead of quietly
// reporting a number over five files.

import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { EXCERPT_BYTES } from "../lib/ai/classify";
import { aiClient, aiConfigured, MODEL } from "../lib/ai/model";
import {
  CLASSIFIABLE_ROLES,
  buildClassifyPrompt,
  normalizeClassification,
} from "../lib/ai/prompt";
import { fetchRawFile, parseRepoUrl } from "../lib/pipeline/github";
import { getStoredAnalysis } from "../lib/pipeline/load";
import { UNCLASSIFIED_ROLE } from "../lib/roles/taxonomy";
import type { Database } from "../lib/supabase/database.types";

// The held-out set this phase requires. Not a tuning knob: the acceptance says
// at least thirty files, so a smaller dataset is a failure to report, not a bar
// to lower.
export const ROLE_DATASET_MINIMUM = 30;

// A ceiling so a very large repository cannot run the eval for an unbounded
// time or cost. It is far above the minimum, and the minimum is asserted first,
// so it never masks a dataset that is too small.
export const ROLE_DATASET_CEILING = 200;

// How many files are asked about at once. Matches the classify stage.
const CONCURRENCY = 4;

// The roles classification is allowed to return, minus "unclassified": a
// decline is not a role, so it can be neither a ground truth nor a correct
// answer.
export function eligibleRoles(): string[] {
  return CLASSIFIABLE_ROLES.filter((role) => role !== UNCLASSIFIED_ROLE);
}

// Was this stored role set by a framework convention and therefore usable as
// ground truth? A role the model assigned ("ai") is excluded on purpose: scoring
// the model against itself would measure nothing.
export function isEligibleGroundTruth(role: string, source: string): boolean {
  return source === "adapter" && eligibleRoles().includes(role);
}

export function assertMinimumDataset(size: number, minimum = ROLE_DATASET_MINIMUM): void {
  if (size < minimum) {
    throw new Error(
      `The role dataset holds ${size} eligible file(s); Phase 11 needs at least ${minimum}. ` +
        "Run the pipeline over a repository with more classifiable files (see evals/analyze.ts).",
    );
  }
}

export interface RoleSample {
  path: string;
  expected: string;
  predicted: string | null;
}

export interface RoleBucket {
  total: number;
  correct: number;
}

export interface RoleScore {
  total: number;
  correct: number;
  // Share of samples whose predicted role equals the framework's. A null
  // prediction counts as a miss: the ground truth says the role was knowable, so
  // a decline is not a correct answer.
  accuracy: number;
  perRole: Record<string, RoleBucket>;
  mismatches: RoleSample[];
}

export function scoreRoleAccuracy(samples: readonly RoleSample[]): RoleScore {
  const perRole: Record<string, RoleBucket> = {};
  const mismatches: RoleSample[] = [];
  let correct = 0;
  for (const sample of samples) {
    const bucket = perRole[sample.expected] ?? (perRole[sample.expected] = { total: 0, correct: 0 });
    bucket.total += 1;
    if (sample.predicted === sample.expected) {
      bucket.correct += 1;
      correct += 1;
    } else {
      mismatches.push(sample);
    }
  }
  return {
    total: samples.length,
    correct,
    accuracy: samples.length === 0 ? 0 : correct / samples.length,
    perRole,
    mismatches,
  };
}

export interface RoleDatasetItem {
  analysisId: string;
  repoUrl: string;
  commitSha: string;
  adapter: string;
  path: string;
  expected: string;
}

export interface RoleDataset {
  items: RoleDatasetItem[];
  // Eligible files per analysis, so a thin dataset shows where they came from.
  perAnalysis: Record<string, number>;
}

// Every eligible adapter-assigned file across every completed analysis. Reads
// the analyses back through the same loader the app uses, so what is scored is
// the repository the app actually stored.
export async function buildRoleDataset(
  client: SupabaseClient<Database>,
): Promise<RoleDataset> {
  const { data, error } = await client
    .from("analyses")
    .select("id")
    .eq("status", "complete")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const analysisIds = (data ?? []).map((row) => row.id);

  const items: RoleDatasetItem[] = [];
  const perAnalysis: Record<string, number> = {};
  for (const analysisId of analysisIds) {
    const stored = await getStoredAnalysis(client, analysisId);
    if (stored === null || stored.result === null) continue;
    if (stored.repoUrl === null || stored.commitSha === null) continue;
    const result = stored.result;
    let count = 0;
    for (const entry of result.roles) {
      if (!isEligibleGroundTruth(entry.role, entry.source ?? "adapter")) continue;
      count += 1;
      items.push({
        analysisId,
        repoUrl: stored.repoUrl,
        commitSha: stored.commitSha,
        adapter: result.adapter,
        path: entry.path,
        expected: entry.role,
      });
    }
    if (count > 0) perAnalysis[analysisId] = count;
  }

  items.sort((a, b) =>
    a.analysisId === b.analysisId
      ? a.path.localeCompare(b.path)
      : a.analysisId.localeCompare(b.analysisId),
  );
  return { items, perAnalysis };
}

// Ask the classifier about one held-out file, cold: its role is not in the
// prompt. Any failure — a fetch that 404s, a model error, a reply that is not an
// allowed word — yields null, which is scored as a miss rather than dropped.
async function predictRole(item: RoleDatasetItem): Promise<string | null> {
  try {
    const ref = parseRepoUrl(item.repoUrl);
    const contents = await fetchRawFile(ref, item.commitSha, item.path);
    const excerpt = contents.slice(0, EXCERPT_BYTES);
    const extension = path.extname(item.path);
    const prompt = buildClassifyPrompt({
      path: item.path,
      extension,
      adapter: item.adapter,
      excerpt,
    });
    const completion = await aiClient().chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 4,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    });
    const answer = completion.choices[0]?.message?.content ?? "";
    return normalizeClassification(answer);
  } catch {
    return null;
  }
}

export interface RoleAccuracyReport {
  datasetSize: number;
  evaluated: number;
  score: RoleScore;
  perAnalysis: Record<string, number>;
}

export async function runRoleAccuracy(
  client: SupabaseClient<Database>,
): Promise<RoleAccuracyReport> {
  if (!aiConfigured()) {
    throw new Error("OPENAI_API_KEY is not set, so the classifier cannot be run. Add it to .env.local.");
  }

  const dataset = await buildRoleDataset(client);
  assertMinimumDataset(dataset.items.length);

  const items = dataset.items.slice(0, ROLE_DATASET_CEILING);
  const samples: RoleSample[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      samples[index] = {
        path: item.path,
        expected: item.expected,
        predicted: await predictRole(item),
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));

  return {
    datasetSize: dataset.items.length,
    evaluated: items.length,
    score: scoreRoleAccuracy(samples),
    perAnalysis: dataset.perAnalysis,
  };
}
