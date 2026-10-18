// The invented-path check: does an explanation name a file that was never shown
// to the model?
//
// The prompt hands the model a fixed list of real paths and tells it those are
// the only files it may name. A model that ignores that — or that pattern-fills
// a plausible neighbour that does not exist — is making something up, and that
// is exactly the failure a reader cannot see. This check finds it without a
// model: it pulls every path-shaped token out of an answer and asks whether each
// one was in the set the prompt showed.
//
// It is deterministic and offline: same answer and same shown set, same verdict.
// The pure half (below) is what the checks in scripts/check-phase11.ts exercise;
// the run half reads real stored explanations so the number reflects real
// traffic, not a fixture.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvaluationResult } from "langsmith/evaluation";

import { getStoredAnalysis } from "../lib/pipeline/load";
import { foldMap } from "../lib/map/fold";
import type { SubjectKind } from "../lib/ai/subject";
import type { Database } from "../lib/supabase/database.types";
import { shownPaths } from "./shown-paths";

// The file extensions that can appear in a path-shaped token. A word with one of
// these after its final dot is treated as a file reference; anything else (a
// domain, a version, prose) is left alone. Kept broad enough to cover the
// languages the parser reads plus the config and docs a repository carries.
const PATH_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs",
  "json", "jsonc", "json5",
  "md", "mdx", "txt", "rst",
  "css", "scss", "sass", "less", "styl",
  "html", "htm", "vue", "svelte", "astro",
  "go", "rs", "py", "rb", "java", "kt", "kts", "scala", "swift", "m", "mm",
  "php", "cs", "fs", "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "ex", "exs",
  "erl", "hrl", "clj", "cljs", "dart", "lua", "pl", "r", "jl", "hs",
  "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties",
  "sql", "graphql", "gql", "prisma", "proto", "tf", "hcl",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "xml", "svg", "lock", "gradle", "cmake", "mk", "dockerfile",
]);

// A run of characters a path can be made of. The class stops at whitespace,
// quotes, backticks, commas, parentheses and markdown, so a path wrapped in any
// of those is caught cleanly; the run must still end in `.<letters>` to count.
const PATH_TOKEN = /[A-Za-z0-9_@][A-Za-z0-9_@./-]*\.[A-Za-z][A-Za-z0-9]*/g;

// Product names that read like filenames but are not. The web ecosystem writes
// frameworks and libraries as `<Name>.js`, so a prose mention of Next.js is a
// shape the tokenizer would otherwise take for a path and flag as invented. A
// name is listed only when it is unambiguously a product and never a plausible
// repository file, so a fabricated path is still caught: only these exact
// spellings are skipped, and anything else ending in a path extension is
// checked as before. Compared case-insensitively.
const PRODUCT_NAMES = new Set([
  "next.js", "nuxt.js", "vue.js", "svelte.js", "react.js", "preact.js",
  "angular.js", "ember.js", "meteor.js", "backbone.js",
  "express.js", "koa.js", "nestjs.js", "node.js", "deno.js", "bun.js",
  "jquery.js", "moment.js", "lodash.js", "underscore.js", "require.js",
  "d3.js", "three.js", "chart.js", "popper.js", "modernizr.js",
]);

// Every path-shaped token in an answer, in order, without duplicates. An empty
// answer yields nothing, which is not a failure: saying nothing cannot invent a
// file. A token that names a known product (Next.js) is not a path and is
// dropped here, before it can be mistaken for an invented file.
export function extractPathTokens(body: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const matches = body.match(PATH_TOKEN);
  if (matches === null) return tokens;
  for (const raw of matches) {
    if (PRODUCT_NAMES.has(raw.toLowerCase())) continue;
    const dot = raw.lastIndexOf(".");
    const extension = dot === -1 ? "" : raw.slice(dot + 1).toLowerCase();
    if (!PATH_EXTENSIONS.has(extension)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(raw);
  }
  return tokens;
}

// Was this token a path the prompt showed? True for the path itself, and for any
// suffix of a shown path at a segment boundary — so a shown `src/interface/x.ts`
// may be named as `interface/x.ts` or `x.ts`. A bare basename counts the same
// way. A token that matches nothing shown is the thing being hunted.
export function isShownPath(token: string, shown: ReadonlySet<string>): boolean {
  if (shown.has(token)) return true;
  for (const path of shown) {
    if (path.endsWith(`/${token}`)) return true;
  }
  return false;
}

export interface PathCheck {
  // Distinct path tokens the answer named.
  tokens: string[];
  // Those that were not shown to the model.
  invented: string[];
}

export function checkInventedPaths(body: string, shown: ReadonlySet<string>): PathCheck {
  const tokens = extractPathTokens(body);
  const invented = tokens.filter((token) => !isShownPath(token, shown));
  return { tokens, invented };
}

// The token-level share of named paths that were real. One when nothing was
// named. Used as the score beside the pass/fail, so a single slip out of many
// references is visible rather than hidden behind a zero.
export function pathCheckScore(check: PathCheck): number {
  if (check.tokens.length === 0) return 1;
  return (check.tokens.length - check.invented.length) / check.tokens.length;
}

export interface InventedPathInputs {
  subjectKind: SubjectKind;
  subjectId: string;
  shownPaths: string[];
}

// The check as a LangSmith evaluator over one example: inputs carry the shown
// set, outputs carry the answer body. A clean answer scores 1, one that names an
// unshown path scores 0, and the comment names the invented path so a reader can
// confirm it by hand.
export function inventedPathEvaluation(example: {
  inputs: InventedPathInputs;
  outputs: { body?: unknown };
}): EvaluationResult {
  const body = typeof example.outputs.body === "string" ? example.outputs.body : "";
  const shown = new Set(example.inputs.shownPaths);
  const check = checkInventedPaths(body, shown);
  return {
    key: "no_invented_paths",
    score: check.invented.length === 0 ? 1 : 0,
    comment:
      check.invented.length === 0
        ? `named only shown paths (${check.tokens.length} path token(s))`
        : `named ${check.invented.length} path(s) that were not shown: ${check.invented.join(", ")}`,
  };
}

interface ExplanationRecord {
  id: string;
  analysis_id: string;
  subject_kind: string;
  subject_id: string;
  body: string;
  created_at: string;
}

// One stored explanation whose analysis and subject could be rebuilt, together
// with the exact set of paths its prompt showed. The sweep and the splice check
// both read through this, so neither re-decides what "rebuildable" means and the
// detection logic below is written once.
export interface LoadedExplanation {
  analysisId: string;
  kind: SubjectKind;
  subjectId: string;
  body: string;
  shown: Set<string>;
}

// Reads the most recent explanations and rebuilds the shown set for each with
// the very limits the prompt used (see shown-paths.ts). Rows whose analysis or
// subject cannot be rebuilt are counted as skipped, never guessed at. Read-only:
// nothing here writes a row.
async function loadExplanations(
  client: SupabaseClient<Database>,
  limit: number,
): Promise<{ items: LoadedExplanation[]; skipped: number }> {
  const { data, error } = await client
    .from("explanations")
    .select("id, analysis_id, subject_kind, subject_id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as ExplanationRecord[];

  const byAnalysis = new Map<string, ExplanationRecord[]>();
  for (const row of rows) {
    const list = byAnalysis.get(row.analysis_id);
    if (list === undefined) byAnalysis.set(row.analysis_id, [row]);
    else list.push(row);
  }

  const items: LoadedExplanation[] = [];
  let skipped = 0;
  for (const [analysisId, list] of byAnalysis) {
    const stored = await getStoredAnalysis(client, analysisId);
    const result = stored?.result ?? null;
    if (result === null) {
      skipped += list.length;
      continue;
    }
    const map = foldMap(result);
    for (const row of list) {
      if (row.subject_kind !== "file" && row.subject_kind !== "folder") {
        skipped += 1;
        continue;
      }
      const kind: SubjectKind = row.subject_kind;
      const shown = shownPaths(result, map, kind, row.subject_id);
      if (shown.size === 0) {
        skipped += 1;
        continue;
      }
      items.push({ analysisId, kind, subjectId: row.subject_id, body: row.body, shown });
    }
  }
  return { items, skipped };
}

export interface PathFailure {
  analysisId: string;
  kind: SubjectKind;
  subjectId: string;
  invented: string[];
  tokens: number;
}

export interface InventedPathReport {
  // Explanations whose subject could be rebuilt and therefore checked.
  evaluated: number;
  // Explanations skipped because their analysis is not complete or their
  // subject is no longer in the parse result.
  skipped: number;
  // Evaluated explanations that named no invented path.
  clean: number;
  // Distinct path tokens across all evaluated explanations, and how many of
  // them were not shown.
  tokens: number;
  inventedTokens: number;
  // Share of evaluated explanations that were clean. The headline number.
  score: number;
  failures: PathFailure[];
}

// Runs the check over the most recent real explanations. Each is grouped by its
// analysis so the parse result is loaded once, and the shown set is recomputed
// with the very limits the prompt used (see shown-paths.ts). Rows whose analysis
// or subject cannot be rebuilt are skipped and counted, never guessed at.
export async function runInventedPathCheck(
  client: SupabaseClient<Database>,
  options: { limit?: number } = {},
): Promise<InventedPathReport> {
  const { items, skipped } = await loadExplanations(client, options.limit ?? 50);

  const report: InventedPathReport = {
    evaluated: 0,
    skipped,
    clean: 0,
    tokens: 0,
    inventedTokens: 0,
    score: 0,
    failures: [],
  };

  for (const item of items) {
    const check = checkInventedPaths(item.body, item.shown);
    report.evaluated += 1;
    report.tokens += check.tokens.length;
    report.inventedTokens += check.invented.length;
    if (check.invented.length === 0) {
      report.clean += 1;
    } else {
      report.failures.push({
        analysisId: item.analysisId,
        kind: item.kind,
        subjectId: item.subjectId,
        invented: check.invented,
        tokens: check.tokens.length,
      });
    }
  }

  report.score = report.evaluated === 0 ? 0 : report.clean / report.evaluated;
  return report;
}

// The fabricated path the splice check injects. A path no repository would hold
// and no prompt would show, so if an answer names it and the detector does not
// flag it, the detector is broken.
export const SPLICE_FABRICATED_PATH = "src/definitely/not-real-file.ts";

// Add the fabricated reference to an answer. Pure string work: the splice exists
// only in memory, so no stored explanation and no database row is touched.
export function spliceAnswer(body: string, fabricatedPath = SPLICE_FABRICATED_PATH): string {
  return `${body}\n\nThis file is imported by ${fabricatedPath}.`;
}

export interface SpliceCheck {
  fabricatedPath: string;
  // The fabricated path was extracted, was not a shown path, and so was
  // reported. True only when that exact path is in the invented set — a verdict
  // that flags some other path, or nothing, is a failure, not a pass.
  detected: boolean;
  // Every path the spliced answer named that was not shown.
  invented: string[];
  // Distinct path tokens the spliced answer named.
  tokens: number;
}

// The pure half of the splice check, exercised offline. Deterministic: the same
// body, shown set and fabricated path give the same verdict, with no model and
// no database.
export function checkSplice(
  body: string,
  shown: ReadonlySet<string>,
  fabricatedPath = SPLICE_FABRICATED_PATH,
): SpliceCheck {
  const check = checkInventedPaths(spliceAnswer(body, fabricatedPath), shown);
  return {
    fabricatedPath,
    detected: check.invented.includes(fabricatedPath),
    invented: check.invented,
    tokens: check.tokens.length,
  };
}

export interface SpliceReport extends SpliceCheck {
  analysisId: string;
  kind: SubjectKind;
  subjectId: string;
  shownCount: number;
  // The evaluator's verdict on the spliced answer — the same LangSmith-shaped
  // result the invented-path experiment would produce. Score 0 is a caught
  // answer; a score of 1 would mean the fabrication slipped through.
  evaluationScore: number;
  evaluationComment: string;
}

// The live splice check: read one real explanation, splice the fabricated path
// into it in memory, and score the spliced answer with the very evaluator the
// experiment uses. Read-only — the stored answer and the database are untouched.
export async function runSpliceCheck(
  client: SupabaseClient<Database>,
  options: { limit?: number; fabricatedPath?: string } = {},
): Promise<SpliceReport> {
  const fabricatedPath = options.fabricatedPath ?? SPLICE_FABRICATED_PATH;
  const { items } = await loadExplanations(client, options.limit ?? 50);
  const item = items[0];
  if (item === undefined) {
    throw new Error(
      "No stored explanation could be rebuilt, so the splice check cannot run. " +
        "Analyse and explain a repository first (npx tsx evals/run.ts analyze <repoUrl>).",
    );
  }
  if (item.shown.has(fabricatedPath)) {
    throw new Error(
      `The fabricated path ${fabricatedPath} is already a shown path, so it cannot ` +
        "prove detection. Pass a different --fabricated-path.",
    );
  }

  const outcome = checkSplice(item.body, item.shown, fabricatedPath);
  const verdict = inventedPathEvaluation({
    inputs: {
      subjectKind: item.kind,
      subjectId: item.subjectId,
      shownPaths: [...item.shown],
    },
    outputs: { body: spliceAnswer(item.body, fabricatedPath) },
  });

  return {
    ...outcome,
    analysisId: item.analysisId,
    kind: item.kind,
    subjectId: item.subjectId,
    shownCount: item.shown.size,
    evaluationScore: typeof verdict.score === "number" ? verdict.score : -1,
    evaluationComment: verdict.comment ?? "",
  };
}
