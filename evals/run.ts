// The single entry point for the Phase 11 evals.
//
//   pnpm eval:paths                invented-path check over recent explanations
//   pnpm eval:paths --splice       adversarial splice check, exits non-zero on a miss
//   pnpm eval:roles                role accuracy over the eligible held-out dataset
//   pnpm eval:prompts              current vs retired prompt, both scores and the gap
//   npx tsx evals/run.ts analyze <repoUrl> [organizationId]
//
// pnpm forwards extra arguments after the script name (pnpm eval:paths --splice
// reaches this file as `invented-paths --splice`); `--` is also accepted.
//
// Every subcommand loads `.env.local` for itself, builds one service-role client,
// and reads only what it needs. Nothing here is imported by the application; the
// evals run against the application's own data and functions.

import { evalSupabaseClient, loadEvalsEnv } from "./env";
import { runInventedPathCheck, runSpliceCheck, SPLICE_FABRICATED_PATH } from "./invented-paths";
import { runRoleAccuracy, ROLE_DATASET_MINIMUM } from "./role-accuracy";
import { runPromptComparison } from "./prompt-versions";
import { seedAnalysis } from "./analyze";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function cmdInventedPaths(args: string[]): Promise<void> {
  const client = evalSupabaseClient();
  if (args.includes("--splice")) {
    await cmdInventedPathSplice(client, args);
    return;
  }

  const report = await runInventedPathCheck(client);
  console.log("Invented-path check — real stored explanations");
  console.log(`  evaluated ${report.evaluated}, skipped ${report.skipped}`);
  console.log(`  score      ${percent(report.score)} clean (${report.clean}/${report.evaluated})`);
  const tokenAccuracy =
    report.tokens === 0 ? 1 : (report.tokens - report.inventedTokens) / report.tokens;
  console.log(
    `  tokens     ${percent(tokenAccuracy)} matched a shown path ` +
      `(${report.tokens - report.inventedTokens}/${report.tokens})`,
  );
  for (const failure of report.failures) {
    console.log(
      `  FAIL  ${failure.kind} ${failure.subjectId}  invented: ${failure.invented.join(", ")}`,
    );
  }
  if (report.evaluated === 0) {
    console.log("  (nothing to check yet: no stored explanation could be rebuilt)");
  }
}

// The deterministic adversarial check: splice a fabricated filename into a real
// explanation and require the detector to name it. Exits non-zero if it does not,
// so a broken detector cannot pass as green.
async function cmdInventedPathSplice(
  client: ReturnType<typeof evalSupabaseClient>,
  args: string[],
): Promise<void> {
  const flag = args.indexOf("--fabricated-path");
  const fabricatedPath = flag === -1 ? undefined : args[flag + 1];

  const report = await runSpliceCheck(
    client,
    fabricatedPath === undefined ? {} : { fabricatedPath },
  );

  console.log("Invented-path splice check — deterministic adversarial test");
  console.log(`  source      ${report.kind} ${report.subjectId}  (analysis ${report.analysisId.slice(0, 8)})`);
  console.log(`  shown       ${report.shownCount} path(s) the prompt showed`);
  console.log(`  fabricated  ${report.fabricatedPath}`);
  console.log(
    `  invented    ${report.invented.length === 0 ? "(none)" : report.invented.join(", ")}`,
  );
  console.log(`  tokens      ${report.tokens} path token(s) in the spliced answer`);
  console.log(`  evaluator   score ${report.evaluationScore}  "${report.evaluationComment}"`);
  console.log(`  detected    ${report.detected ? "yes" : "no"}`);

  if (!report.detected) {
    console.log("  RESULT      FAIL — the fabricated path was NOT caught");
    process.exitCode = 1;
    return;
  }
  console.log(`  RESULT      PASS — ${fabricatedPath ?? SPLICE_FABRICATED_PATH} was caught`);
}

async function cmdRoleAccuracy(): Promise<void> {
  const client = evalSupabaseClient();
  const report = await runRoleAccuracy(client);
  console.log("Role accuracy — framework roles vs. the classifier");
  console.log(
    `  dataset    ${report.datasetSize} eligible file(s) (minimum ${ROLE_DATASET_MINIMUM}); ` +
      `scored ${report.evaluated}`,
  );
  for (const [analysisId, count] of Object.entries(report.perAnalysis)) {
    console.log(`    ${analysisId.slice(0, 8)}  ${count}`);
  }
  console.log(`  accuracy   ${percent(report.score.accuracy)} (${report.score.correct}/${report.score.total})`);
  const roles = Object.keys(report.score.perRole).sort();
  for (const role of roles) {
    const bucket = report.score.perRole[role];
    console.log(`    ${role.padEnd(12)} ${percent(bucket.correct / bucket.total)} (${bucket.correct}/${bucket.total})`);
  }
  for (const miss of report.score.mismatches) {
    console.log(`  MISS  ${miss.path}  expected ${miss.expected}, got ${miss.predicted ?? "(none)"}`);
  }
}

async function cmdPromptVersions(): Promise<void> {
  const client = evalSupabaseClient();
  const report = await runPromptComparison(client);
  console.log(`Prompt comparison — dataset ${report.datasetName}, ${report.files} file(s)`);
  console.log("  path".padEnd(50) + "file/current  file/v0");
  for (const row of report.perFile) {
    const v1 = row.v1 === null ? "  -  " : row.v1.toFixed(2);
    const v0 = row.v0 === null ? "  -  " : row.v0.toFixed(2);
    console.log(`  ${row.path.padEnd(48)} ${v1.padStart(10)}  ${v0.padStart(8)}`);
  }
  console.log(`  mean usefulness (model judge, 0-1):`);
  console.log(`    file/current  ${report.meanV1.toFixed(3)}`);
  console.log(`    file/v0       ${report.meanV0.toFixed(3)}`);
  console.log(`    difference    ${report.difference >= 0 ? "+" : ""}${report.difference.toFixed(3)}`);
  console.log(
    `  runs/scored   file/current ${report.runsV1}/${report.scoredV1}, ` +
      `file/v0 ${report.runsV0}/${report.scoredV0}`,
  );
  if (!report.complete) {
    console.log(
      "  RESULT        INCOMPLETE — one side produced no scored runs, so the means are not a completed comparison",
    );
    console.log(
      "                  Re-run to produce both experiments; do not read the printed numbers as a result.",
    );
    process.exitCode = 1;
    return;
  }
  console.log("  RESULT        complete — both experiments ran and scored; the difference above is measured.");
}

async function cmdAnalyze(args: string[]): Promise<void> {
  const repoUrl = args[0];
  if (repoUrl === undefined || repoUrl.trim() === "") {
    throw new Error("Usage: npx tsx evals/run.ts analyze <repoUrl> [organizationId]");
  }
  const client = evalSupabaseClient();
  const result = await seedAnalysis(client, { repoUrl, organizationId: args[1] });
  if (result.existing) {
    console.log(`Already analysed: ${result.analysisId} (nothing run again)`);
  } else {
    console.log(`Analysed ${result.repoUrl}`);
    console.log(`  analysis   ${result.analysisId}`);
  }
  console.log(`  workspace  ${result.organizationId}`);
  console.log("Now run: npx tsx evals/run.ts role-accuracy");
}

async function main(): Promise<void> {
  loadEvalsEnv();
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "invented-paths":
      return cmdInventedPaths(args);
    case "role-accuracy":
      return cmdRoleAccuracy();
    case "prompt-versions":
      return cmdPromptVersions();
    case "analyze":
      return cmdAnalyze(args);
    default:
      console.log(
        "Usage: npx tsx evals/run.ts <invented-paths [--splice]|role-accuracy|prompt-versions|analyze> [args]",
      );
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
