// Offline checks for Phase 11.
//
// The evals talk to a real database, a real model and real LangSmith; none of
// that can run here. What can run here is every decision the evals make with the
// model taken out: which files count as ground truth, whether the dataset clears
// the minimum, how the invented-path check reads an answer, whether the shown
// set matches what the prompt actually printed, and how the judge's verdict maps
// to a score. Those are the parts that must not drift silently.
//
// Run with `npx tsx scripts/check-phase11.ts`.

import { readFileSync } from "node:fs";
import path from "node:path";

import { buildFilePrompt, buildFolderPrompt, type Prompt } from "../lib/ai/prompt";
import { fileNeighbourhood, folderContext, roleByPath } from "../lib/ai/context";
import { foldMap, type FoldedMap } from "../lib/map/fold";
import type { ParseResult } from "../lib/parser/types";
import {
  assertMinimumDataset,
  eligibleRoles,
  isEligibleGroundTruth,
  ROLE_DATASET_MINIMUM,
  scoreRoleAccuracy,
  type RoleSample,
} from "../evals/role-accuracy";
import {
  checkInventedPaths,
  checkSplice,
  extractPathTokens,
  inventedPathEvaluation,
  isShownPath,
  pathCheckScore,
  spliceAnswer,
  SPLICE_FABRICATED_PATH,
} from "../evals/invented-paths";
import { buildFileV0Prompt, FILE_V0_VERSION } from "../evals/prompts/file-v0";
import { comparisonComplete, parseJudgeScore } from "../evals/prompt-versions";
import { shownPaths } from "../evals/shown-paths";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  ->  got ${JSON.stringify(actual)}`}`);
}

function checkEqual(label: string, actual: Set<string>, expected: string[]): void {
  check(label, [...actual].sort(), [...expected].sort());
}

// ---------------------------------------------------------------------------
// The repository the checks reason about. Five files over four folders, with
// edges that give src/a.ts real neighbours and the src folder real outside
// connections, so the shown set is not trivially just the subject.
// ---------------------------------------------------------------------------

function sampleResult(): ParseResult {
  return {
    version: 1,
    root: "sample",
    parsedAt: "2026-01-01T00:00:00.000Z",
    adapter: "react",
    counts: { found: 5, parsed: 5, skipped: 0 },
    files: [
      { path: "src/a.ts", folder: "src", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "ha", fanIn: 0, fanOut: 2 },
      { path: "src/b.ts", folder: "src", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "hb", fanIn: 2, fanOut: 0 },
      { path: "lib/c.ts", folder: "lib", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "hc", fanIn: 2, fanOut: 1 },
      { path: "pkg/d.ts", folder: "pkg", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "hd", fanIn: 0, fanOut: 1 },
      { path: "app/e.ts", folder: "app", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "he", fanIn: 0, fanOut: 1 },
    ],
    edges: [
      { source: "src/a.ts", target: "src/b.ts", kind: "import" },
      { source: "src/a.ts", target: "lib/c.ts", kind: "import" },
      { source: "lib/c.ts", target: "src/b.ts", kind: "import" },
      { source: "pkg/d.ts", target: "lib/c.ts", kind: "import" },
      { source: "app/e.ts", target: "pkg/d.ts", kind: "import" },
    ],
    roles: [
      { path: "src/a.ts", role: "component", source: "adapter" },
      { path: "src/b.ts", role: "hook", source: "adapter" },
      { path: "lib/c.ts", role: "util", source: "adapter" },
      { path: "pkg/d.ts", role: "config", source: "adapter" },
      { path: "app/e.ts", role: "unclassified", source: "adapter" },
    ],
    routes: [],
    skipped: [],
    coverage: {
      importsSeen: 5,
      resolved: 5,
      outside: 0,
      externalUnresolved: 0,
      excluded: 0,
      failed: 0,
      byKind: { import: 5, "re-export": 0, dynamic: 0 },
      reExportsFound: 0,
      reExportsResolved: 0,
      failures: [],
      examples: { outside: [], excluded: [] },
    },
  };
}

// The real fold, so the folder node ids and their file sets are the ones the
// application would produce, not a hand-written map.
function sampleMap(result: ParseResult): FoldedMap {
  return foldMap(result);
}

// The list of paths, and only paths, a prompt printed before the file contents.
// Reading the prompt's own text is the point: it is the independent side of the
// drift guard that shownPaths() is checked against.
function listPathsFromPrompt(prompt: Prompt): Set<string> {
  const before = prompt.user.split("--- file contents ---")[0];
  const paths = new Set<string>();
  for (const line of before.split(/\r?\n/)) {
    const file = line.match(/^File: (.+)$/);
    if (file !== null) {
      paths.add(file[1].trim());
      continue;
    }
    const folder = line.match(/^Folder: (.+?)(?: \(the repository root\))?$/);
    if (folder !== null) {
      paths.add(folder[1].trim());
      continue;
    }
    const item = line.match(/^- (.+)$/);
    if (item === null) continue;
    const token = item[1].replace(/ \(.*\)$/, "").trim();
    if (/^\(.*\)$/.test(token)) continue;
    paths.add(token);
  }
  return paths;
}

function main(): void {
  const result = sampleResult();
  const map = sampleMap(result);
  const roles = roleByPath(result);

  // -------------------------------------------------------------------------
  // 1. Dataset eligibility: only conventional, classifiable roles count.
  // -------------------------------------------------------------------------
  check("eligible roles are the classifiable ones without unclassified", eligibleRoles(), [
    "service",
    "repository",
    "model",
    "util",
    "config",
    "component",
    "hook",
  ]);
  check("eligible roles exclude unclassified", eligibleRoles().includes("unclassified"), false);
  check("an adapter component is eligible ground truth", isEligibleGroundTruth("component", "adapter"), true);
  check("an adapter config is eligible ground truth", isEligibleGroundTruth("config", "adapter"), true);
  check("an unclassified role is not ground truth", isEligibleGroundTruth("unclassified", "adapter"), false);
  check("a model-assigned role is not ground truth", isEligibleGroundTruth("component", "ai"), false);
  check("a structural role is not ground truth", isEligibleGroundTruth("controller", "adapter"), false);
  check("a page role is not ground truth", isEligibleGroundTruth("page", "adapter"), false);

  // -------------------------------------------------------------------------
  // 2. The minimum-dataset rule: thirty files, no fewer, and it must shout.
  // -------------------------------------------------------------------------
  check("the minimum is thirty", ROLE_DATASET_MINIMUM, 30);
  check("a dataset of twenty-nine is refused", throws(() => assertMinimumDataset(29)), true);
  check("a dataset of thirty is accepted", throws(() => assertMinimumDataset(30)), false);
  check("a dataset of thirty-one is accepted", throws(() => assertMinimumDataset(31)), false);

  // -------------------------------------------------------------------------
  // 3. Role accuracy: counting, per-role buckets, and where the misses are.
  // -------------------------------------------------------------------------
  const samples: RoleSample[] = [
    { path: "a", expected: "component", predicted: "component" },
    { path: "b", expected: "component", predicted: "util" },
    { path: "c", expected: "service", predicted: "service" },
    { path: "d", expected: "util", predicted: null },
  ];
  const score = scoreRoleAccuracy(samples);
  check("role accuracy counts the total", score.total, 4);
  check("role accuracy counts the correct", score.correct, 2);
  check("role accuracy is correct over total", score.accuracy, 0.5);
  check("role accuracy buckets per expected role: component", score.perRole.component, { total: 2, correct: 1 });
  check("role accuracy buckets per expected role: service", score.perRole.service, { total: 1, correct: 1 });
  check("a null prediction is a miss", score.mismatches.map((m) => m.path).sort(), ["b", "d"]);
  check("an empty sample scores zero", scoreRoleAccuracy([]).accuracy, 0);

  // -------------------------------------------------------------------------
  // 4. The invented-path check: which tokens count, and which were shown.
  // -------------------------------------------------------------------------
  check(
    "extracts path-shaped tokens and drops prose words",
    extractPathTokens("It imports `src/a.ts` and **src/b.ts**, plus src/ghost.ts."),
    ["src/a.ts", "src/b.ts", "src/ghost.ts"],
  );
  check(
    "ignores domains, versions and identifiers",
    extractPathTokens("See example.com, v1.2.3, and useThing."),
    [],
  );
  check("a trailing dot is not part of the token", extractPathTokens("Read src/a.ts."), ["src/a.ts"]);
  check("duplicate tokens are collapsed", extractPathTokens("src/a.ts and src/a.ts"), ["src/a.ts"]);
  check("a sentence with no file scores a clean one", pathCheckScore(checkInventedPaths("No files here.", new Set())), 1);

  const shownSet = new Set(["src/interface/error.interface.ts"]);
  check("the full shown path is shown", isShownPath("src/interface/error.interface.ts", shownSet), true);
  check("a path suffix of a shown file is shown", isShownPath("interface/error.interface.ts", shownSet), true);
  check("a bare basename of a shown file is shown", isShownPath("error.interface.ts", shownSet), true);
  check("an unrelated path is not shown", isShownPath("src/ghost.ts", shownSet), false);

  const invented = checkInventedPaths("See `src/a.ts` and `src/ghost.ts`.", new Set(["src/a.ts"]));
  check("the invented-path check names the fabricated path", invented.invented, ["src/ghost.ts"]);
  check("the invented-path check counts every path token", invented.tokens.length, 2);
  check("the token score reflects the one real of two", pathCheckScore(invented), 0.5);

  const verdict = inventedPathEvaluation({
    inputs: { subjectKind: "file", subjectId: "src/a.ts", shownPaths: ["src/a.ts"] },
    outputs: { body: "See src/ghost.ts." },
  });
  check("the evaluator fails an answer that names an unshown path", verdict.score, 0);
  check("the evaluator names the invented path in its comment", verdict.comment?.includes("src/ghost.ts"), true);
  const clean = inventedPathEvaluation({
    inputs: { subjectKind: "file", subjectId: "src/a.ts", shownPaths: ["src/a.ts"] },
    outputs: { body: "It is imported by src/a.ts." },
  });
  check("the evaluator passes a grounded answer", clean.score, 1);

  // A product name is not a path: the tokenizer would otherwise take Next.js for
  // a file and report an invented one. Detection of genuine fabricated paths —
  // with or without a separator — must survive that exclusion.
  check(
    "a product name is not a path token",
    extractPathTokens("Built with Next.js."),
    [],
  );
  check(
    "a product name is not a path token in either case",
    extractPathTokens("Built with nuxt.js and Vue.js."),
    [],
  );
  const frameworkMention = checkInventedPaths("Built with Next.js.", new Set(["src/a.ts"]));
  check("a product name in prose invents nothing", frameworkMention.invented, []);
  check("a product name does not disturb other tokens", extractPathTokens("See src/a.ts with Next.js."), [
    "src/a.ts",
  ]);
  const bareFake = checkInventedPaths("It needs ghost.ts.", new Set(["src/a.ts"]));
  check(
    "a fabricated bare filename without a separator is still caught",
    bareFake.invented,
    ["ghost.ts"],
  );
  const slashFake = checkInventedPaths("See src/forged/module.ts.", new Set(["src/a.ts"]));
  check("a fabricated path with a separator is still caught", slashFake.invented, [
    "src/forged/module.ts",
  ]);

  // The splice check: inject a fabricated filename into an answer in memory.
  const splice = checkSplice("It is imported by src/a.ts.", new Set(["src/a.ts"]));
  check("the splice check detects the fabricated path", splice.detected, true);
  check("the splice check names the fabricated path it caught", splice.invented, [
    SPLICE_FABRICATED_PATH,
  ]);
  check(
    "the default fabricated path is the documented one",
    SPLICE_FABRICATED_PATH,
    "src/definitely/not-real-file.ts",
  );
  const spliceCustom = checkSplice(
    "It is imported by src/a.ts.",
    new Set(["src/a.ts"]),
    "src/forged/hallucinated.ts",
  );
  check("a custom fabricated path is detected too", spliceCustom.detected, true);
  check("a custom fabricated path is reported by name", spliceCustom.invented, [
    "src/forged/hallucinated.ts",
  ]);
  const shownFabrication = checkSplice(
    "It is imported by src/a.ts.",
    new Set(["src/a.ts"]),
    "src/a.ts",
  );
  check(
    "a fabricated path that was shown is not reported as invented",
    shownFabrication.detected,
    false,
  );
  const spliceVerdict = inventedPathEvaluation({
    inputs: { subjectKind: "file", subjectId: "src/a.ts", shownPaths: ["src/a.ts"] },
    outputs: { body: spliceAnswer("It is imported by src/a.ts.") },
  });
  check("the evaluator scores a spliced answer zero", spliceVerdict.score, 0);
  check(
    "the evaluator names the fabricated path",
    spliceVerdict.comment?.includes(SPLICE_FABRICATED_PATH),
    true,
  );
  check(
    "spliceAnswer does not write to the database and is in-memory only",
    typeof spliceAnswer("x").length,
    "number",
  );

  // -------------------------------------------------------------------------
  // 5. The shown set matches the prompt — the drift guard.
  // -------------------------------------------------------------------------
  const neighbourhood = fileNeighbourhood(result, "src/a.ts", roles);
  const filePrompt = buildFilePrompt({
    path: "src/a.ts",
    role: roles.get("src/a.ts") ?? "unclassified",
    adapter: result.adapter,
    contents: 'import x from "./z.ts";',
    dependencies: neighbourhood.dependencies,
    dependents: neighbourhood.dependents,
  });
  checkEqual(
    "file shown set equals the paths in the real file prompt",
    shownPaths(result, map, "file", "src/a.ts"),
    [...listPathsFromPrompt(filePrompt)],
  );
  checkEqual(
    "file shown set is the subject plus its neighbours",
    shownPaths(result, map, "file", "src/a.ts"),
    ["src/a.ts", "lib/c.ts", "src/b.ts"],
  );
  check("a path inside the file contents is not a shown path", listPathsFromPrompt(filePrompt).has("z.ts"), false);

  const srcContext = folderContext(result, map, "src", roles);
  if (srcContext === null) throw new Error("the fixture's src folder must exist");
  const folderPrompt = buildFolderPrompt({ adapter: result.adapter, ...srcContext });
  checkEqual(
    "folder shown set equals the paths in the real folder prompt",
    shownPaths(result, map, "folder", "src"),
    [...listPathsFromPrompt(folderPrompt)],
  );
  checkEqual(
    "folder shown set is the folder, its files and its outside connections",
    shownPaths(result, map, "folder", "src"),
    ["src", "src/a.ts", "src/b.ts", "lib/c.ts"],
  );
  check("a folder that is not in the map shows nothing", shownPaths(result, map, "folder", "nope").size, 0);
  check("a file that is not in the result shows nothing", shownPaths(result, map, "file", "nope.ts").size, 0);

  // -------------------------------------------------------------------------
  // 6. The prompt comparison: the two prompts differ where it matters.
  // -------------------------------------------------------------------------
  const v0Prompt = buildFileV0Prompt({
    path: "src/a.ts",
    role: "component",
    adapter: result.adapter,
    contents: "export const a = 1;",
    dependencies: neighbourhood.dependencies,
    dependents: neighbourhood.dependents,
  });
  check("the retired prompt carries its own version", FILE_V0_VERSION, "file/v0");
  check("both prompts name the file", v0Prompt.user.includes("File: src/a.ts") && filePrompt.user.includes("File: src/a.ts"), true);
  check("the current prompt lists the file's imports", filePrompt.user.includes("This file imports:"), true);
  check("the retired prompt does not list neighbours", v0Prompt.user.includes("This file imports:"), false);
  check("the two prompts differ", v0Prompt.system !== filePrompt.system, true);
  check("a judge rating of one is the floor", parseJudgeScore("1 - vague."), 0.2);
  check("an unreadable verdict has no score", parseJudgeScore("I think it is quite good."), null);

  // A comparison is only a comparison when both experiments ran and scored. An
  // interrupted run leaves a complete file-v1-* with no matching file-v0-*, and
  // reporting a mean for one side against zero for the other invents a gap that
  // was never measured.
  check(
    "both sides running and scoring is a completed comparison",
    comparisonComplete({ runsV1: 30, runsV0: 30, scoredV1: 30, scoredV0: 30 }),
    true,
  );
  check(
    "an interrupted run with no v0 experiment is not a comparison",
    comparisonComplete({ runsV1: 30, runsV0: 0, scoredV1: 30, scoredV0: 0 }),
    false,
  );
  check(
    "runs with no readable judge verdicts are not a comparison",
    comparisonComplete({ runsV1: 30, runsV0: 30, scoredV1: 30, scoredV0: 0 }),
    false,
  );
  check(
    "a side that ran but scored nothing is not a comparison",
    comparisonComplete({ runsV1: 30, runsV0: 30, scoredV1: 0, scoredV0: 30 }),
    false,
  );
  check(
    "an empty comparison is not a comparison",
    comparisonComplete({ runsV1: 0, runsV0: 0, scoredV1: 0, scoredV0: 0 }),
    false,
  );

  // -------------------------------------------------------------------------
  // 7. Where the retired prompt lives, and that the check stays model-free.
  // -------------------------------------------------------------------------
  const appPrompt = readSource("lib/ai/prompt.ts");
  check("the application prompt has no retired version", /file\/v0|FILE_V0/.test(appPrompt), false);
  check("the retired prompt exists under evals", readSource("evals/prompts/file-v0.ts").includes("FILE_V0_VERSION"), true);
  const inventedSource = readSource("evals/invented-paths.ts");
  check("the invented-path check names no model client", /aiClient|openai/.test(inventedSource), false);
  check("the invented-path check makes no network call of its own", /fetch\(/.test(inventedSource.split("runInventedPathCheck")[0]), false);
  check("the invented-path check never writes to the database", /\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(inventedSource), false);

  // -------------------------------------------------------------------------
  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

function readSource(relative: string): string {
  try {
    return readFileSync(path.resolve(process.cwd(), relative), "utf8");
  } catch {
    return "";
  }
}

main();
