// Comparing two explanation prompts as two LangSmith experiments.
//
// The current prompt and the retired one (evals/prompts/file-v0.ts) are run over
// the same files, one experiment each, and both are scored by the same
// usefulness judge. LangSmith shows them side by side and this file prints the
// two means and their difference, so "the new prompt is better" is a number.
//
// The judge is a model, and that is said plainly: a score from gpt-4o-mini is an
// opinion with a number attached, not a measurement of truth. It is used because
// usefulness is not something a rule can read off an answer; the invented-path
// check is where the deterministic, model-free scoring lives. The judge is given
// the file's real neighbours so it can tell a grounded answer from a vague one.

import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import type { EvaluationResult } from "langsmith/evaluation";

import { fileNeighbourhood, roleByPath } from "../lib/ai/context";
import { aiClient, aiConfigured, MODEL } from "../lib/ai/model";
import { buildFilePrompt, type PromptNeighbour } from "../lib/ai/prompt";
import { fetchRawFile, parseRepoUrl } from "../lib/pipeline/github";
import { getStoredAnalysis } from "../lib/pipeline/load";
import type { ParseResult } from "../lib/parser/types";
import type { Database } from "../lib/supabase/database.types";
import { requireEnv } from "./env";
import { buildFileV0Prompt } from "./prompts/file-v0";

// How many files the comparison runs over. Bounded because each file costs two
// generation calls and one judge call.
const DEFAULT_FILES = 30;

// The dataset and the two experiment prefixes. The dataset is named per analysis
// so two runs over different repositories do not overwrite each other's example
// set.
const DATASET_PREFIX = "explanation-file";
const V1_PREFIX = "file-v1";
const V0_PREFIX = "file-v0";

// The shape carried on every dataset example: everything a file prompt needs,
// copied from the stored analysis so both prompts see the same facts.
export interface FileExampleInputs {
  path: string;
  role: string;
  adapter: string;
  contents: string;
  dependencies: PromptNeighbour[];
  dependents: PromptNeighbour[];
}

const JUDGE_SYSTEM = [
  "You grade one explanation of a single file in a software repository, for a",
  "reader who has that file selected on a map. You are given the file's path, its",
  "role, and the real lists of the files it imports and the files that import it,",
  "then the explanation. Score how useful and specific it is, from 1 (vague,",
  "generic, or wrong about how the file relates to others) to 5 (concrete, tells",
  "the reader what the file does and how it fits, and names a real neighbour only",
  "where that helps). Then reply with the single digit first, a dash, and one",
  "short sentence of reason. Example: `4 - names the real importer and says what",
  "the file is for.`",
].join("\n");

function judgeUser(inputs: FileExampleInputs, answer: string): string {
  const neighbours = (label: string, files: readonly PromptNeighbour[]): string =>
    files.length === 0 ? `${label}: none` : `${label}: ${files.map((f) => f.path).join(", ")}`;
  return [
    `Path: ${inputs.path}`,
    `Role: ${inputs.role}`,
    neighbours("Imports", inputs.dependencies),
    neighbours("Imported by", inputs.dependents),
    "",
    "Explanation:",
    answer,
  ].join("\n");
}

// The judge's verdict as a score in 0..1, or null when it did not begin with a
// digit from 1 to 5. A verdict that cannot be read is left without a score
// rather than scored as a zero. Exported so the checks can pin the mapping.
export function parseJudgeScore(raw: string): number | null {
  const match = raw.trim().match(/^([1-5])\b/);
  if (match === null) return null;
  return Number(match[1]) / 5;
}

async function judge(example: {
  inputs: FileExampleInputs;
  outputs: Record<string, unknown>;
}): Promise<EvaluationResult> {
  const answer = typeof example.outputs.answer === "string" ? example.outputs.answer : "";
  const completion = await aiClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: 80,
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: judgeUser(example.inputs, answer) },
    ],
  });
  const raw = (completion.choices[0]?.message?.content ?? "").trim();
  const score = parseJudgeScore(raw);
  // A verdict that could not be read carries no score rather than a zero, so a
  // judge that rambles does not quietly drag a prompt's mean down; the comment
  // still records what it said.
  return {
    key: "usefulness",
    ...(score === null ? {} : { score }),
    comment: raw || "(no verdict)",
  };
}

// One example's worth of inputs, read back from the analysis. Files that cannot
// be fetched at their stored commit are dropped rather than guessed at.
function toExample(
  result: ParseResult,
  roles: ReturnType<typeof roleByPath>,
  adapter: string,
  path: string,
  contents: string,
): FileExampleInputs {
  const neighbourhood = fileNeighbourhood(result, path, roles);
  return {
    path,
    role: roles.get(path) ?? "unclassified",
    adapter,
    contents,
    dependencies: neighbourhood.dependencies,
    dependents: neighbourhood.dependents,
  };
}

type LangsmithExperiment = Awaited<ReturnType<typeof evaluate>>;

// Aligning the two experiments file by file means keying on the path each
// example was built from — stable across both prompts, unlike the run id.
function usefulnessByPath(experiment: LangsmithExperiment): Map<string, number> {
  const scores = new Map<string, number>();
  for (const row of experiment.results) {
    const inputs = row.example.inputs as { path?: unknown };
    const found = row.evaluationResults.results.find((entry) => entry.key === "usefulness");
    if (typeof inputs.path === "string" && typeof found?.score === "number") {
      scores.set(inputs.path, found.score);
    }
  }
  return scores;
}

function meanOf(scores: Map<string, number>): number {
  if (scores.size === 0) return 0;
  let total = 0;
  for (const score of scores.values()) total += score;
  return total / scores.size;
}

export interface PromptComparisonReport {
  datasetName: string;
  files: number;
  perFile: { path: string; v1: number | null; v0: number | null }[];
  meanV1: number;
  meanV0: number;
  difference: number;
  runsV1: number;
  runsV0: number;
  scoredV1: number;
  scoredV0: number;
  complete: boolean;
}

// A comparison is complete only when both experiments produced runs and both
// scored at least one file. An interrupted run leaves a full `file-v1-*` with no
// matching `file-v0-*`; reporting a mean for the side that ran against a zero
// for the side that did not would invent a difference that was never measured.
export function comparisonComplete(counts: {
  runsV1: number;
  runsV0: number;
  scoredV1: number;
  scoredV0: number;
}): boolean {
  return counts.runsV1 > 0 && counts.runsV0 > 0 && counts.scoredV1 > 0 && counts.scoredV0 > 0;
}

// Picks the completed analysis whose result holds the most files, then the most
// connected files inside it — the ones with a neighbour, so the difference
// between a grounded prompt and an ungrounded one can actually show.
async function selectAnalysisAndFiles(
  client: SupabaseClient<Database>,
  limit: number,
): Promise<{
  analysisId: string;
  repoUrl: string;
  commitSha: string;
  adapter: string;
  result: ParseResult;
  paths: string[];
} | null> {
  const { data, error } = await client
    .from("analyses")
    .select("id")
    .eq("status", "complete")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  let best: {
    analysisId: string;
    repoUrl: string;
    commitSha: string;
    adapter: string;
    result: ParseResult;
    paths: string[];
  } | null = null;

  for (const row of data ?? []) {
    const stored = await getStoredAnalysis(client, row.id);
    if (stored === null || stored.result === null) continue;
    if (stored.repoUrl === null || stored.commitSha === null) continue;
    const result = stored.result;
    const roles = roleByPath(result);
    const paths = result.files
      .map((file) => file.path)
      .filter((path) => {
        const neighbourhood = fileNeighbourhood(result, path, roles);
        return neighbourhood.dependencies.length + neighbourhood.dependents.length > 0;
      })
      .sort((a, b) => a.localeCompare(b));
    if (best === null || paths.length > best.paths.length) {
      best = {
        analysisId: row.id,
        repoUrl: stored.repoUrl,
        commitSha: stored.commitSha,
        adapter: result.adapter,
        result,
        paths,
      };
    }
  }

  if (best === null) return null;
  return { ...best, paths: best.paths.slice(0, limit) };
}

export async function runPromptComparison(
  client: SupabaseClient<Database>,
  options: { limit?: number } = {},
): Promise<PromptComparisonReport> {
  if (!aiConfigured()) {
    throw new Error("OPENAI_API_KEY is not set, so the comparison cannot run. Add it to .env.local.");
  }
  const limit = options.limit ?? DEFAULT_FILES;

  const selection = await selectAnalysisAndFiles(client, limit);
  if (selection === null) {
    throw new Error("No completed analysis with neighbours was found to run the comparison over.");
  }

  const roles = roleByPath(selection.result);
  const ref = parseRepoUrl(selection.repoUrl);
  const examples: FileExampleInputs[] = [];
  for (const path of selection.paths) {
    try {
      const contents = await fetchRawFile(ref, selection.commitSha, path);
      examples.push(toExample(selection.result, roles, selection.adapter, path, contents));
    } catch {
      // A file that cannot be read at its commit is left out, not filled in.
    }
  }
  if (examples.length === 0) {
    throw new Error("None of the selected files could be read at their commit.");
  }

  const client_ = new Client({ apiKey: requireEnv("LANGSMITH_API_KEY") });
  const datasetName = `${DATASET_PREFIX}-${selection.analysisId.slice(0, 8)}`;
  const hasDataset = await client_.hasDataset({ datasetName });
  if (!hasDataset) {
    await client_.createDataset(datasetName, {
      description: `Held-out files for the file-prompt comparison (analysis ${selection.analysisId}).`,
    });
    await client_.createExamples(
      examples.map((inputs) => ({ dataset_name: datasetName, inputs })),
    );
  }

  const targetV1 = async (input: FileExampleInputs): Promise<{ answer: string }> => {
    return { answer: await complete(buildFilePrompt(input)) };
  };
  const targetV0 = async (input: FileExampleInputs): Promise<{ answer: string }> => {
    const prompt = buildFileV0Prompt(input);
    return { answer: await complete(prompt) };
  };

  const v1 = (await evaluate(targetV1 as never, {
    data: datasetName,
    evaluators: [judge as never],
    experimentPrefix: V1_PREFIX,
    description: "Current file explanation prompt.",
    client: client_,
    metadata: { phase: 11, analysisId: selection.analysisId, prompt: "file/current" },
  } as never)) as unknown as LangsmithExperiment;
  const v0 = (await evaluate(targetV0 as never, {
    data: datasetName,
    evaluators: [judge as never],
    experimentPrefix: V0_PREFIX,
    description: "Retired file explanation prompt (file/v0).",
    client: client_,
    metadata: { phase: 11, analysisId: selection.analysisId, prompt: "file/v0" },
  } as never)) as unknown as LangsmithExperiment;

  const v1Scores = usefulnessByPath(v1);
  const v0Scores = usefulnessByPath(v0);
  const perFile = examples.map((example) => ({
    path: example.path,
    v1: v1Scores.get(example.path) ?? null,
    v0: v0Scores.get(example.path) ?? null,
  }));

  const meanV1 = meanOf(v1Scores);
  const meanV0 = meanOf(v0Scores);
  const runsV1 = v1.results.length;
  const runsV0 = v0.results.length;
  const scoredV1 = v1Scores.size;
  const scoredV0 = v0Scores.size;
  return {
    datasetName,
    files: examples.length,
    perFile,
    meanV1,
    meanV0,
    difference: meanV1 - meanV0,
    runsV1,
    runsV0,
    scoredV1,
    scoredV0,
    complete: comparisonComplete({ runsV1, runsV0, scoredV1, scoredV0 }),
  };
}

// The model call both targets make: ask, take the first answer. Traced through
// the wrapped client, so each run appears under its experiment.
async function complete(prompt: { system: string; user: string }): Promise<string> {
  const completion = await aiClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}
