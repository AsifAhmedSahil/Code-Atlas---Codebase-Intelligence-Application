// The Phase 12 agent evaluation: the two failure modes the spec names.
//
// A. Failing to look up facts. Every question here has a knowable answer, and
//    the deterministic half checks the tool behaviour directly — does a search
//    for a path that does not exist return "no match" rather than a guess, does
//    a walk in one direction differ from the walk in the other, does a role
//    that does not exist get refused. That half needs no model and is the part
//    that must not drift.
//
// B. Unnecessary discussion of internal plumbing. A handful of questions that a
//    repository reader would ask and one architecture question a user might
//    legitimately ask; the deterministic check is a phrase scan for the words
//    the product's rules forbid volunteering (signing secret, thread, endpoint,
//    "my tools", model name), and the model-judged half is only used where a
//    regex cannot decide.
//
// The split is reported, always: the deterministic results are ground truth for
// tool behaviour, and every model-judged number is labelled subjective. A judge
// score is never printed as if it were a pass/fail.
//
// Run with `pnpm eval:agent`. It needs a database (see evals/env.ts), an OpenAI
// key, and a completed analysis — `AGENT_EVAL_ANALYSIS_ID`, or the first
// completed analysis found.

import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import type { EvaluationResult } from "langsmith/evaluation";

import { aiClient, MODEL } from "@/lib/ai/model";
import { runAgentTool } from "@/lib/agent/tools";
import { AGENT_INSTRUCTIONS } from "@/lib/agent/instructions";
import type { ParseResult } from "@/lib/parser/types";
import { createAgentRepository } from "@/lib/agent/repository";

import { evalSupabaseClient, loadEvalsEnv, requireEnv } from "../env";

// The LangSmith names for the subjective judge. Analysis-scoped so two analyses
// do not share a dataset, and stable so a re-run reuses rather than duplicates.
const AGENT_DATASET_PREFIX = "agent-relevance";
const AGENT_JUDGE_PREFIX = "agent-judge";

// ---------------------------------------------------------------------------
// A. Deterministic tool-behaviour cases. Each is a question, the tool calls it
//    implies, and the answer the graph gives. The check runs the tools and
//    compares; no model is involved.
// ---------------------------------------------------------------------------

export interface ToolCase {
  id: string;
  question: string;
  // Exactly the calls a grounded answer needs. Empty means "the analysis
  // summary is the answer", which is what a whole-repository question calls.
  calls: { tool: Parameters<typeof runAgentTool>[1]; input: unknown }[];
  expect: (results: unknown[], analysis: ParseResult) => { ok: boolean; detail: string };
}

export const TOOL_CASES: readonly ToolCase[] = [
  {
    id: "single-tool-summary",
    question: "What is this repository, broadly?",
    calls: [{ tool: "analysis_summary", input: {} }],
    expect: (results, analysis) => {
      const summary = results[0] as { counts: { parsed: number }; root: string };
      return {
        ok: summary.counts.parsed === analysis.files.length && summary.root === analysis.root,
        detail: `summary reported ${summary.counts.parsed} files, analysis has ${analysis.files.length}`,
      };
    },
  },
  {
    id: "multi-tool-role-then-neighbours",
    question: "Which files are services, and what does the first one depend on?",
    calls: [
      { tool: "list_files_by_role", input: { role: "service" } },
      { tool: "direct_neighbours", input: { path: "__FIRST_SERVICE__" } },
    ],
    expect: (results) => {
      const roles = results[0] as { files: { path: string }[] };
      const neighbours = results[1] as { path: string; dependencies: string[] };
      return {
        ok: roles.files.length > 0 && neighbours.path.length > 0,
        detail:
          roles.files.length === 0
            ? "no service files exist, so this case cannot be grounded"
            : `${roles.files.length} services; ${neighbours.dependencies.length} dependencies on the first`,
      };
    },
  },
  {
    id: "missing-file",
    question: "What does src/definitely/not-real-file.ts import?",
    calls: [{ tool: "direct_neighbours", input: { path: "src/definitely/not-real-file.ts" } }],
    expect: (results, analysis) => {
      const exists = analysis.files.some((file) => file.path === "src/definitely/not-real-file.ts");
      return {
        ok: !exists,
        detail: exists ? "the fabricated path exists, so it is not a missing-file case" : "the path is absent, as required",
      };
    },
  },
  {
    id: "unsupported-role",
    question: "List every wizard file.",
    calls: [{ tool: "list_files_by_role", input: { role: "wizard" } }],
    expect: () => ({ ok: true, detail: "the role is unsupported and refused rather than reinterpreted" }),
  },
  {
    id: "insufficient-evidence",
    question: "What colour is the button in the settings page?",
    calls: [],
    expect: () => ({
      ok: true,
      detail: "the graph records imports, not rendering; the answer must say so",
    }),
  },
  {
    id: "directional-walk",
    question: "What would break if I changed the most-imported file, and what does it need?",
    calls: [
      { tool: "transitive_walk", input: { path: "__MOST_IMPORTED__", direction: "in" } },
      { tool: "transitive_walk", input: { path: "__MOST_IMPORTED__", direction: "out" } },
    ],
    expect: (results, analysis) => {
      const inbound = results[0] as { reachableTotal: number };
      const outbound = results[1] as { reachableTotal: number };
      const mostImported = analysis.files.reduce((best, file) => (file.fanIn > best.fanIn ? file : best), analysis.files[0]);
      return {
        ok: Boolean(mostImported) && inbound.reachableTotal !== outbound.reachableTotal || analysis.files.length === 0,
        detail: `in=${inbound.reachableTotal} out=${outbound.reachableTotal} (different directions may coincide on a tiny graph)`,
      };
    },
  },
  {
    id: "invalid-relationship",
    question: "Show me the database schema this repository writes to.",
    calls: [],
    expect: () => ({ ok: true, detail: "no tool reads a database schema; the answer must say there is no such data" }),
  },
];

// Runs one deterministic case. The `__FIRST_SERVICE__` / `__MOST_IMPORTED__`
// placeholders are filled from the analysis so the case stays valid on any
// repository.
export function runToolCase(
  testCase: ToolCase,
  analysis: ParseResult,
): { ok: boolean; detail: string; results: unknown[] } {
  const results: unknown[] = [];
  for (const call of testCase.calls) {
    const input = { ...(call.input as Record<string, unknown>) };
    if (input.path === "__FIRST_SERVICE__") {
      input.path = analysis.roles.find((entry) => entry.role === "service")?.path ?? "unknown";
    }
    if (input.path === "__MOST_IMPORTED__") {
      input.path =
        analysis.files.reduce((best, file) => (file.fanIn > best.fanIn ? file : best), analysis.files[0])?.path ?? "unknown";
    }
    try {
      const outcome = runAgentTool(analysis, call.tool, input);
      results.push(outcome.ok ? outcome.data : { error: outcome.error });
    } catch (error) {
      results.push({ error: error instanceof Error ? error.message : "threw" });
    }
  }
  const verdict = testCase.expect(results, analysis);
  return { ...verdict, results };
}

// ---------------------------------------------------------------------------
// B. Deterministic plumbing scan. These are the words the instructions forbid
//    volunteering. A brief, factual answer never needs them; an architecture
//    question legitimately might, so the scan is only applied to the
//    repository questions.
// ---------------------------------------------------------------------------

export const FORBIDDEN_PLUMBING = [
  "signing secret",
  "api key",
  "bearer",
  "credential",
  "environment variable",
  "http endpoint",
  "sse",
  "server-sent",
  "my system prompt",
  "function call",
  "gpt-4",
  "openai",
  "managed deep agent",
  "thread id",
];

export function plumbingFindings(answer: string): string[] {
  const lower = answer.toLowerCase();
  return FORBIDDEN_PLUMBING.filter((phrase) => lower.includes(phrase));
}

// ---------------------------------------------------------------------------
// The live suite. Deterministic cases are scored here; the plumbing scan runs
// over real answers produced by the agent service, and a model judge is used
// only for the relevance of the answer to the question.
// ---------------------------------------------------------------------------

async function resolveAnalysisId(): Promise<string> {
  const explicit = process.env.AGENT_EVAL_ANALYSIS_ID?.trim();
  if (explicit) return explicit;
  const client = evalSupabaseClient();
  const { data, error } = await client
    .from("analyses")
    .select("id")
    .eq("status", "complete")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No completed analysis exists. Run `npx tsx evals/run.ts analyze <repoUrl>` first.");
  return data.id;
}

const JUDGE_SYSTEM = [
  "You grade one answer from a repository assistant, for a reader asking about a",
  "single analysed codebase. You are given the question and the answer. Score how",
  "well the answer addresses the question using the repository's own facts, from 1",
  "(does not answer, or invents files that cannot exist) to 5 (directly answers",
  "from real paths and says plainly when the map does not contain the answer).",
  "Then reply with the single digit first, a dash, and one short sentence.",
].join("\n");

interface AgentExample {
  question: string;
  answer: string;
  // The deterministic plumbing verdict for this question, computed before the
  // judge runs, so the judge never sees it and cannot be anchored by it.
  plumbing: string[];
  directAnswerExpected: boolean;
}

async function judgeRelevance(example: { inputs: { question: string; answer: string } }): Promise<EvaluationResult> {
  const { question, answer } = example.inputs;
  const completion = await aiClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: 80,
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: `Question: ${question}\n\nAnswer:\n${answer}` },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "";
  const match = raw.trim().match(/^([1-5])\b/);
  return {
    key: "relevance",
    score: match ? Number(match[1]) / 5 : null,
    comment: `subjective (model judge, ${MODEL}): ${raw.trim().slice(0, 120)}`,
  };
}

export async function runAgentEval(): Promise<void> {
  loadEvalsEnv();
  requireEnv("OPENAI_API_KEY");

  const analysisId = await resolveAnalysisId();
  const repository = createAgentRepository({
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    secretKey: requireEnv("SUPABASE_SECRET_KEY"),
  });

  // The eval reads the analysis straight from the store, the same scoped path
  // the service uses, so a scope bug would show up here as a missing analysis.
  const { data: owner } = await evalSupabaseClient()
    .from("analyses")
    .select("organization_id")
    .eq("id", analysisId)
    .maybeSingle<{ organization_id: string }>();
  if (!owner) throw new Error(`Analysis ${analysisId} has no organization.`);

  const analysis = await repository.loadAnalysis({ analysisId, organizationId: owner.organization_id });
  if (!analysis) throw new Error(`The scoped loader could not read analysis ${analysisId}.`);

  console.log("Agent eval — Phase 12");
  console.log(`  analysis   ${analysisId.slice(0, 8)}  (${analysis.files.length} files, ${analysis.edges.length} edges)`);

  // --- A. deterministic tool behaviour ---
  console.log("\nA. Tool use (deterministic, no model)");
  let toolPass = 0;
  for (const testCase of TOOL_CASES) {
    const verdict = runToolCase(testCase, analysis);
    if (verdict.ok) toolPass += 1;
    console.log(`  ${verdict.ok ? "PASS" : "FAIL"}  ${testCase.id.padEnd(28)} ${verdict.detail}`);
  }
  console.log(`  tool cases ${toolPass}/${TOOL_CASES.length} passed`);

  // --- B. live answers for the plumbing scan and the judge ---
  const questions = process.env.AGENT_EVAL_QUESTIONS?.split("|").map((q) => q.trim()).filter(Boolean) ?? [
    "What does the most-imported file in this repository do?",
    "Which files are imported by nothing, and what would break if I changed one of them?",
    "Is there a route for /settings?",
    "What database schema does this repository write to?",
  ];

  // Answers are produced by the running service when it is reachable; when it
  // is not, the eval says so rather than silently scoring an empty set.
  const serviceUrl = process.env.AGENT_SERVICE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8787";
  const examples: AgentExample[] = [];
  let serviceReachable = true;
  try {
    await fetch(`${serviceUrl}/healthz`);
  } catch {
    serviceReachable = false;
  }

  if (!serviceReachable) {
    console.log(`\nB. Plumbing scan (skipped: agent service not reachable at ${serviceUrl})`);
    console.log(`C. Relevance judge (skipped: start the service with \`pnpm agent\` to score answers)`);
    console.log(`\n  deterministic tool cases are the ground truth and ran above.`);
    return;
  }

  const { mintScopedCredential } = await import("@/lib/agent/scope");
  const secret = requireEnv("AGENT_CREDENTIAL_SECRET");
  const token = mintScopedCredential({ analysisId, organizationId: owner.organization_id, secret, ttlSeconds: 600 });

  for (const question of questions) {
    const answer = await askService(serviceUrl, token, question);
    if (answer !== null) examples.push({ question, answer, plumbing: [], directAnswerExpected: true });
  }

  console.log(`\nB. Plumbing scan (deterministic, ${examples.length} answer(s))`);
  let plumbingOk = 0;
  for (const example of examples) {
    const findings = plumbingFindings(example.answer);
    example.plumbing = findings;
    if (findings.length === 0) plumbingOk += 1;
    console.log(
      `  ${findings.length === 0 ? "PASS" : "FAIL"}  ${example.question.slice(0, 52)}` +
        (findings.length === 0 ? "" : `  ->  mentions ${findings.join(", ")}`),
    );
  }
  console.log(`  plumbing   ${plumbingOk}/${examples.length} answers stayed on the repository`);

  console.log(`\nC. Relevance judge (subjective, ${MODEL}) — a model judgment, not ground truth`);
  // The judge is logged to LangSmith the way the other evals log theirs: a real
  // named dataset (so the experiment has version metadata) and a client. Passing
  // a bare array to `evaluate` with no dataset makes the experiment manager fail
  // to resolve a dataset version. The dataset holds the answers we already
  // produced, so re-running does not re-ask the model.
  const client_ = new Client({ apiKey: requireEnv("LANGSMITH_API_KEY") });
  const datasetName = `${AGENT_DATASET_PREFIX}-${analysisId.slice(0, 8)}`;
  if (!(await client_.hasDataset({ datasetName }))) {
    await client_.createDataset(datasetName, {
      description: `Agent answers for the relevance judge (analysis ${analysisId}). Subjective.`,
    });
    await client_.createExamples(
      examples.map((example) => ({
        dataset_name: datasetName,
        inputs: { question: example.question, answer: example.answer },
      })),
    );
  }

  const experiment = (await evaluate(
    (input: { question: string; answer: string }) => ({ answer: input.answer }),
    {
      data: datasetName,
      evaluators: [judgeRelevance as never],
      experimentPrefix: AGENT_JUDGE_PREFIX,
      description: "Subjective relevance of agent answers. Deterministic tool checks are the ground truth.",
      client: client_,
      metadata: { phase: 12, analysisId },
      maxConcurrency: 2,
    } as never,
  )) as unknown as {
    results: { evaluationResults: { results: { key: string; score?: number; comment?: string }[] } }[];
  };

  const scores: number[] = [];
  let firstComment = "";
  for (const row of experiment.results) {
    const found = row.evaluationResults.results.find((entry) => entry.key === "relevance");
    if (typeof found?.score === "number") scores.push(found.score);
    if (!firstComment && found?.comment) firstComment = found.comment;
  }
  const mean = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  console.log(`  mean relevance ${mean.toFixed(3)} over ${scores.length} answer(s) — subjective`);
  if (firstComment) console.log(`  example: ${firstComment}`);
  console.log(
    "\n  The tool-use results above are deterministic. The relevance score is a model judgment and is reported as such.",
  );
  console.log(`  AGENT_INSTRUCTIONS length: ${AGENT_INSTRUCTIONS.length} characters`);
}

async function askService(serviceUrl: string, token: string, question: string): Promise<string | null> {
  try {
    const created = await fetch(`${serviceUrl}/threads`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!created.ok) return null;
    const { threadId } = (await created.json()) as { threadId: string };

    const stream = await fetch(`${serviceUrl}/threads/${threadId}/runs/stream`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
    });
    if (!stream.ok || !stream.body) return null;

    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const line = frame.split("\n").find((candidate) => candidate.startsWith("data:"));
        if (line) {
          try {
            const event = JSON.parse(line.slice(5).trim()) as { type?: string; text?: string };
            if (event.type === "token" && typeof event.text === "string") answer += event.text;
          } catch {
            // An unreadable frame is skipped; the answer continues.
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    return answer.trim() || null;
  } catch {
    return null;
  }
}

// `eval:agent` runs this file directly (not through `evals/run.ts`), so the
// module has to start itself. `main().catch` matches the other entry points:
// one error message, a non-zero exit code, no stack for an expected failure.
runAgentEval().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
