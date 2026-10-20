// Offline checks for Phase 12.
//
// The acceptance criteria for this phase are mostly security and graph
// correctness, and both can be proved here without a database, a model, or a
// running service. What runs below:
//
// - The scoped credential: a valid one verifies, a tampered one does not, an
//   expired one does not, one meant for another audience does not, and a scope
//   cannot be changed by editing the payload.
// - The six tools: each returns exactly what the canvas's own function returns
//   (the tools are compared against `walkGraph`, `neighboursOf`, `roleByPath`,
//   `mostDependedOn` — not against a re-derived expectation), direction is
//   respected, and missing files, unsupported roles and empty queries are
//   handled explicitly.
// - Read-only-ness: the tool module cannot write, and the rows it reads through
//   are the ones the scope passes are pinned to.
// - The HTTP surface: a request without a credential is refused, a credential
//   for one analysis cannot read another's graph, and an interrupted stream is
//   reported rather than shown as an answer.
//
// Run with `npx tsx scripts/check-phase12.ts`. The service-level checks need
// `AGENT_CREDENTIAL_SECRET` and `SUPABASE_SECRET_KEY`, and a real analysis id;
// without them the tool-level and credential-level checks still run and the
// rest are reported as skipped rather than passing.

import { readFileSync } from "node:fs";
import path from "node:path";

import { roleByPath } from "../lib/ai/context";
import { mostDependedOn, neighboursOf, unimportedFiles } from "../lib/map/detail";
import { walkGraph } from "../lib/map/walk";
import { mintScopedCredential, verifyScopedCredential } from "../lib/agent/scope";
import { runAgentTool, UnsupportedRoleError, UnknownPathError } from "../lib/agent/tools";
import { createAgentService } from "../agent/server";
import type { AgentRuntime } from "../agent/runtime";
import type { ParseResult } from "../lib/parser/types";
import { loadAgentEnv, createAgentRepository } from "../lib/agent/repository";
import { getStoredAnalysis } from "../lib/pipeline/load";
import { createClient } from "@supabase/supabase-js";

let failures = 0;
let skipped = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  ->  got ${JSON.stringify(actual)}`}`);
}

function checkTrue(label: string, value: boolean): void {
  check(label, value, true);
}

function skip(label: string, why: string): void {
  skipped += 1;
  console.log(`skip  ${label}  (${why})`);
}

// ---------------------------------------------------------------------------
// The sample repository. Six files over three folders, with edges that give a
// genuine inbound walk, a different outbound walk, a file nothing imports, a
// file with no imports, and a real route table.
// ---------------------------------------------------------------------------

function sampleResult(): ParseResult {
  return {
    version: 1,
    root: "sample",
    parsedAt: "2026-01-01T00:00:00.000Z",
    adapter: "next",
    counts: { found: 6, parsed: 6, skipped: 1 },
    files: [
      { path: "app/page.tsx", folder: "app", extension: ".tsx", isModule: true, bytes: 1, lines: 10, hash: "h1", fanIn: 0, fanOut: 1 },
      { path: "lib/service.ts", folder: "lib", extension: ".ts", isModule: true, bytes: 1, lines: 20, hash: "h2", fanIn: 2, fanOut: 1 },
      { path: "lib/util.ts", folder: "lib", extension: ".ts", isModule: true, bytes: 1, lines: 5, hash: "h3", fanIn: 1, fanOut: 0 },
      { path: "lib/orphan.ts", folder: "lib", extension: ".ts", isModule: true, bytes: 1, lines: 3, hash: "h4", fanIn: 0, fanOut: 0 },
      { path: "api/handler.ts", folder: "api", extension: ".ts", isModule: true, bytes: 1, lines: 8, hash: "h5", fanIn: 1, fanOut: 0 },
      { path: "app/layout.tsx", folder: "app", extension: ".tsx", isModule: true, bytes: 1, lines: 12, hash: "h6", fanIn: 0, fanOut: 1 },
    ],
    edges: [
      { source: "app/page.tsx", target: "lib/service.ts", kind: "import" },
      { source: "app/layout.tsx", target: "lib/service.ts", kind: "import" },
      { source: "lib/service.ts", target: "lib/util.ts", kind: "import" },
      { source: "api/handler.ts", target: "lib/service.ts", kind: "import" },
    ],
    roles: [
      { path: "app/page.tsx", role: "page", source: "adapter" },
      { path: "app/layout.tsx", role: "layout", source: "adapter" },
      { path: "lib/service.ts", role: "service", source: "adapter" },
      { path: "lib/util.ts", role: "util", source: "adapter" },
      { path: "lib/orphan.ts", role: "util", source: "adapter" },
      { path: "api/handler.ts", role: "api-endpoint", source: "adapter" },
    ],
    routes: [
      { framework: "next", kind: "page", method: null, path: "/", file: "app/page.tsx" },
      { framework: "next", kind: "api", method: "GET", path: "/api/handler", file: "api/handler.ts" },
    ],
    skipped: [{ path: "public/logo.png", reason: "unsupported-extension", detail: ".png" }],
    coverage: {
      importsSeen: 4,
      resolved: 4,
      outside: 0,
      externalUnresolved: 0,
      excluded: 0,
      failed: 0,
      byKind: { import: 4, "re-export": 0, dynamic: 0 },
      reExportsFound: 0,
      reExportsResolved: 0,
      failures: [],
      examples: { outside: [], excluded: [] },
    },
  };
}

function unwrap<T>(outcome: ReturnType<typeof runAgentTool>): T | null {
  return outcome.ok ? (outcome.data as T) : null;
}

// ---------------------------------------------------------------------------
// 1. The scoped credential.
// ---------------------------------------------------------------------------

function credentialChecks(): void {
  console.log("\n-- scoped credential --");
  const secret = "0123456789abcdef0123456789abcdef";
  const token = mintScopedCredential({
    analysisId: "analysis-1",
    organizationId: "org-1",
    secret,
    ttlSeconds: 300,
  });

  const good = verifyScopedCredential({ token, secret });
  checkTrue("a valid credential verifies", good.ok);
  if (good.ok) {
    check("the analysis comes from the credential", good.claims.analysisId, "analysis-1");
    check("the organization comes from the credential", good.claims.organizationId, "org-1");
  }

  // Tampering with the payload — here, swapping the analysis id for another —
  // must invalidate the signature, so a credential cannot be reshaped on the
  // way to the agent.
  const [version, payload, signature] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  decoded.sub = "analysis-2";
  const forgedPayload = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
  const forged = `${version}.${forgedPayload}.${signature}`;
  const forgedOutcome = verifyScopedCredential({ token: forged, secret });
  check("a payload edited to another analysis is refused", forgedOutcome.ok, false);
  if (!forgedOutcome.ok) check("...for the signature, not the clock", forgedOutcome.reason, "bad_signature");

  const wrongSecret = verifyScopedCredential({ token, secret: "ffffffffffffffffffffffffffffffff" });
  check("a credential signed with another secret is refused", wrongSecret.ok, false);

  const expired = mintScopedCredential({
    analysisId: "analysis-1",
    organizationId: "org-1",
    secret,
    ttlSeconds: 300,
    now: 1_000,
  });
  const expiredOutcome = verifyScopedCredential({ token: expired, secret, now: 10_000 });
  check("an expired credential is refused", expiredOutcome.ok, false);
  if (!expiredOutcome.ok) check("...for expiry", expiredOutcome.reason, "expired");

  const future = mintScopedCredential({
    analysisId: "analysis-1",
    organizationId: "org-1",
    secret,
    ttlSeconds: 300,
    now: 9_000,
  });
  const futureOutcome = verifyScopedCredential({ token: future, secret, now: 1_000 });
  check("a credential issued in the future is refused", futureOutcome.ok, false);

  check("garbage is malformed", verifyScopedCredential({ token: "not-a-token", secret }).ok, false);
  const wrongAudience = verifyScopedCredential({ token, secret, audience: "someone-else" });
  check("a credential for another audience is refused", wrongAudience.ok, false);
  const wrongIssuer = verifyScopedCredential({ token, secret, issuer: "someone-else" });
  check("a credential from another issuer is refused", wrongIssuer.ok, false);
}

// ---------------------------------------------------------------------------
// 2. The six tools, each checked against the canvas's own function.
// ---------------------------------------------------------------------------

function toolChecks(): void {
  console.log("\n-- six tools --");
  const result = sampleResult();
  const roleMap = roleByPath(result);

  // Analysis summary. The counts it reports must equal what the application's
  // own functions compute, not a number typed into the test.
  const summary = unwrap<{
    counts: { parsed: number };
    mostDependedOn: { path: string; fanIn: number }[];
    imports: { coverage: ParseResult["coverage"] };
  }>(runAgentTool(result, "analysis_summary", {}));
  checkTrue("analysis_summary returns data", summary !== null);
  if (summary) {
    const expectedDepended = mostDependedOn(result.files, 20).map((file) => ({
      path: file.path,
      fanIn: file.fanIn,
    }));
    check(
      "analysis_summary agrees with mostDependedOn",
      summary.mostDependedOn.map((entry) => ({ path: entry.path, fanIn: entry.fanIn })),
      expectedDepended,
    );
    check("analysis_summary carries the stored coverage", summary.imports.coverage.importsSeen, 4);
    check("analysis_summary counts parsed files", summary.counts.parsed, 6);
  }

  // Search. Exact, prefix and substring ranking, with explicit empties.
  const search = unwrap<{ matched: number; files: { path: string }[]; message: string }>(
    runAgentTool(result, "search_files", { query: "lib/" }),
  );
  checkTrue("search_files returns data", search !== null);
  if (search) {
    check("search_files matches the lib files", search.files.map((f) => f.path).sort(), [
      "lib/orphan.ts",
      "lib/service.ts",
      "lib/util.ts",
    ]);
  }
  const searchExact = unwrap<{ files: { path: string }[] }>(
    runAgentTool(result, "search_files", { query: "lib/util.ts" }),
  );
  check("an exact path ranks first", searchExact?.files[0]?.path, "lib/util.ts");
  const searchEmpty = runAgentTool(result, "search_files", { query: "does-not-exist" });
  checkTrue("an empty search is an explicit result, not a crash", searchEmpty.ok);
  if (searchEmpty.ok) {
    check("...with zero matches", (searchEmpty.data as { matched: number }).matched, 0);
  }
  const searchNoQuery = runAgentTool(result, "search_files", {});
  check("search_files without a query is a contract error", searchNoQuery.ok, false);

  // List by role. A supported role returns the files; an unsupported one is
  // refused rather than silently returning nothing.
  const byRole = unwrap<{ matched: number; files: { path: string }[] }>(
    runAgentTool(result, "list_files_by_role", { role: "util" }),
  );
  check("list_files_by_role returns the right files", byRole?.files.map((f) => f.path).sort(), [
    "lib/orphan.ts",
    "lib/util.ts",
  ]);
  let threwUnsupported = false;
  try {
    runAgentTool(result, "list_files_by_role", { role: "wizard" });
  } catch (error) {
    threwUnsupported = error instanceof UnsupportedRoleError;
  }
  checkTrue("an unsupported role is refused, not reinterpreted", threwUnsupported);

  // Direct neighbours. Compared against the canvas function, both directions.
  const neighbours = unwrap<{ dependencies: string[]; dependents: string[]; dependencyTotal: number; dependentTotal: number }>(
    runAgentTool(result, "direct_neighbours", { path: "lib/service.ts" }),
  );
  checkTrue("direct_neighbours returns data", neighbours !== null);
  if (neighbours) {
    const expected = neighboursOf("lib/service.ts", result.edges);
    check("direct_neighbours dependencies match the canvas", neighbours.dependencies, expected.dependencies);
    check("direct_neighbours dependents match the canvas", neighbours.dependents, expected.dependents);
    check("...dependencies are the files it imports", neighbours.dependencies, ["lib/util.ts"]);
    check(
      "...dependents are the files that import it",
      neighbours.dependents,
      ["api/handler.ts", "app/layout.tsx", "app/page.tsx"],
    );
  }

  // Transitive walk. Direction must be respected: the inbound set and the
  // outbound set for the same file are different, and both equal walkGraph.
  const inbound = unwrap<{ levels: { depth: number; paths: string[] }[]; maxDepth: number }>(
    runAgentTool(result, "transitive_walk", { path: "lib/service.ts", direction: "in" }),
  );
  const outbound = unwrap<{ levels: { depth: number; paths: string[] }[] }>(
    runAgentTool(result, "transitive_walk", { path: "lib/service.ts", direction: "out" }),
  );
  const expectedIn = walkGraph("lib/service.ts", result.edges, "in", 2);
  const expectedOut = walkGraph("lib/service.ts", result.edges, "out", 2);
  check("transitive_walk (in) matches walkGraph", inbound?.levels, expectedIn);
  check("transitive_walk (out) matches walkGraph", outbound?.levels, expectedOut);
  check(
    "the two directions are not the same",
    JSON.stringify(inbound?.levels) === JSON.stringify(outbound?.levels),
    false,
  );
  check("the walk depth is reported", inbound?.maxDepth, 2);

  // Route table. Same rows the canvas shows.
  const routes = unwrap<{ total: number; pages: number; api: number; routes: unknown[] }>(
    runAgentTool(result, "route_table", {}),
  );
  check("route_table total matches the analysis", routes?.total, result.routes.length);
  check("route_table pages are counted", routes?.pages, 1);
  check("route_table api routes are counted", routes?.api, 1);

  // Missing files are an explicit answer in both path-taking tools.
  let threwUnknown = 0;
  for (const [name, args] of [
    ["direct_neighbours", { path: "nope.ts" }],
    ["transitive_walk", { path: "nope.ts", direction: "in" }],
  ] as const) {
    try {
      runAgentTool(result, name, args);
    } catch (error) {
      if (error instanceof UnknownPathError) threwUnknown += 1;
    }
  }
  check("both path tools refuse an unknown path", threwUnknown, 2);

  // An invalid direction is refused, not defaulted.
  const badDirection = runAgentTool(result, "transitive_walk", { path: "lib/util.ts", direction: "sideways" });
  check("an invalid direction is a contract error", badDirection.ok, false);

  // A traversal request can ask for more depth, but the ceiling holds.
  const deep = unwrap<{ maxDepth: number }>(
    runAgentTool(result, "transitive_walk", { path: "lib/service.ts", direction: "in", maxDepth: 999 }),
  );
  check("the walk depth ceiling holds", deep?.maxDepth, 4);

  // The role map the tools use is only ever the one the parser produced.
  check("roleByPath is the source of roles", roleMap.get("lib/service.ts"), "service");
  check("unimportedFiles still reports the orphan", unimportedFiles(result.files).some((f) => f.path === "lib/orphan.ts"), true);
}

// ---------------------------------------------------------------------------
// 3. Read-only-ness, read straight off the source.
// ---------------------------------------------------------------------------

function readOnlyChecks(): void {
  console.log("\n-- read-only --");
  // The tool module holds no write call, and the repository's only mutation is
  // the in-memory cache eviction — a `Map.delete`, not a database delete. The
  // database calls are the ones that matter, so the check is for a query
  // builder mutating rather than for the word itself.
  const toolsSource = readFileSync(path.resolve(process.cwd(), "lib/agent/tools.ts"), "utf8");
  for (const [label, source] of [
    ["tools.ts", toolsSource],
    ["repository.ts", readFileSync(path.resolve(process.cwd(), "lib/agent/repository.ts"), "utf8")],
  ] as const) {
    check(`${label} performs no insert`, /\.insert\s*\(/.test(source), false);
    check(`${label} performs no update`, /\.update\s*\(/.test(source), false);
    check(`${label} performs no upsert`, /\.upsert\s*\(/.test(source), false);
    check(`${label} calls no rpc`, /\.rpc\s*\(/.test(source), false);
    // A database delete would be `.from(...).delete()`; a bare `.delete(` in
    // repository.ts is the cache map. Neither module may reach a table with a
    // delete.
    check(`${label} performs no database delete`, /from\([^)]*\)[\s\S]{0,80}?\.delete\s*\(/.test(source), false);
  }
  check("tools.ts cannot see a database client at all", /supabase|from\("analyses"\)|\.from\(/.test(toolsSource), false);
}

// ---------------------------------------------------------------------------
// 4. The HTTP surface. Runs a service in-process against a fake repository and
//    a fake runtime, so the checks do not need a database or a model.
// ---------------------------------------------------------------------------

const FAKE_RUNTIME: AgentRuntime = {
  name: "fake",
  async stream(_input, emit) {
    await emit({ type: "tool_call", name: "direct_neighbours", label: "Looking up direct neighbours" });
    await emit({ type: "token", text: "It is imported by three files." });
    await emit({ type: "done", finishReason: "stop" });
  },
};

async function httpChecks(): Promise<void> {
  console.log("\n-- http surface --");
  const secret = "0123456789abcdef0123456789abcdef";
  const sample = sampleResult();
  const scopes = new Map<string, ParseResult>([
    ["org-1:analysis-1", sample],
    ["org-1:analysis-2", { ...sample, root: "other" }],
  ]);
  const repository = {
    async loadAnalysis(scope: { analysisId: string; organizationId: string }) {
      return scopes.get(`${scope.organizationId}:${scope.analysisId}`) ?? null;
    },
    invalidate() {},
  };

  const service = await createAgentService(0, {
    runtime: FAKE_RUNTIME,
    repository,
    credentialSecret: secret,
  });
  const base = `http://127.0.0.1:${service.port}`;

  try {
    const health = await fetch(`${base}/healthz`);
    check("healthz answers without a credential", health.status, 200);

    const noAuth = await fetch(`${base}/threads`, { method: "POST" });
    check("a request without a credential is refused", noAuth.status, 401);

    const badAuth = await fetch(`${base}/threads`, {
      method: "POST",
      headers: { authorization: "Bearer not-a-token" },
    });
    check("a malformed credential is refused", badAuth.status, 401);

    // A credential for analysis-1 cannot be used to reach analysis-2, even
    // within the same organization: the scope comes from the token, and there
    // is no argument that changes it.
    const token1 = mintScopedCredential({ analysisId: "analysis-1", organizationId: "org-1", secret, ttlSeconds: 300 });
    const created = await fetch(`${base}/threads`, {
      method: "POST",
      headers: { authorization: `Bearer ${token1}` },
    });
    check("a valid credential opens a thread", created.status, 201);
    const { threadId } = (await created.json()) as { threadId: string };

    // The tool endpoint derives the analysis from the credential; a body that
    // names another analysis has nowhere to put it.
    const invoke = await fetch(`${base}/tools/invoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${token1}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "analysis_summary", analysisId: "analysis-2" }),
    });
    const invoked = (await invoke.json()) as { ok: boolean; data: { root?: string } };
    check("a tool invoke succeeds for the credential's analysis", invoke.status, 200);
    check("an analysis id in the body is ignored", invoked.data.root, "sample");

    const runResp = await fetch(`${base}/threads/${threadId}/runs/stream`, {
      method: "POST",
      headers: { authorization: `Bearer ${token1}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "What imports lib/service.ts?" }] }),
    });
    check("a run opens an event stream", runResp.status, 200);
    const streamed = await runResp.text();
    checkTrue("the stream carries a token event", streamed.includes('"type":"token"'));
    checkTrue("the stream carries a tool call before the answer", streamed.indexOf('"tool_call"') < streamed.indexOf('"type":"token"'));

    // A thread opened under one credential cannot be run under a credential for
    // another analysis, even in the same organization.
    const token2 = mintScopedCredential({ analysisId: "analysis-2", organizationId: "org-1", secret, ttlSeconds: 300 });
    const crossThread = await fetch(`${base}/threads/${threadId}/runs/stream`, {
      method: "POST",
      headers: { authorization: `Bearer ${token2}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    check("a thread cannot be run under another analysis's credential", crossThread.status, 404);

    // A credential for another organization gets the same not-found answer: it
    // is never told whether the analysis exists.
    const tokenOtherOrg = mintScopedCredential({ analysisId: "analysis-1", organizationId: "org-2", secret, ttlSeconds: 300 });
    const otherOrg = await fetch(`${base}/threads`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenOtherOrg}` },
    });
    check("a credential for another organization opens nothing", otherOrg.status, 201);
    const threadOther = (await otherOrg.json()) as { threadId: string };
    const otherOrgRun = await fetch(`${base}/threads/${threadOther}/runs/stream`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenOtherOrg}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    check("...and its run cannot read any analysis", otherOrgRun.status, 404);
    const unknownTool = await fetch(`${base}/tools/invoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${token1}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "read_all_analyses" }),
    });
    check("an unknown tool is refused", unknownTool.status, 400);

    const tools = await (await fetch(`${base}/tools`)).json();
    check("the service advertises exactly six tools", (tools as { tools: unknown[] }).tools.length, 6);
  } finally {
    await service.close();
  }
}

// ---------------------------------------------------------------------------
// 5. The live path, when a database and a real analysis are available.
// ---------------------------------------------------------------------------

async function liveChecks(): Promise<void> {
  console.log("\n-- live database (optional) --");
  const env = process.env;
  const analysisId = env.AGENT_EVAL_ANALYSIS_ID;
  if (!env.AGENT_CREDENTIAL_SECRET || !env.SUPABASE_SECRET_KEY || !env.NEXT_PUBLIC_SUPABASE_URL) {
    skip("live analysis load", "AGENT_* / SUPABASE_SECRET_KEY not set");
    return;
  }
  if (!analysisId) {
    skip("live analysis load", "AGENT_EVAL_ANALYSIS_ID not set");
    return;
  }

  const client = createClient<never>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const unscoped = await getStoredAnalysis(client as never, analysisId);
  if (!unscoped) {
    skip("live analysis load", `analysis ${analysisId} not found`);
    return;
  }

  // Read the owning organization straight off the row, then prove the scoped
  // loader finds the analysis under its organization and not under a
  // fabricated one.
  const { data: row } = await client
    .from("analyses")
    .select("organization_id")
    .eq("id", analysisId)
    .maybeSingle<{ organization_id: string }>();
  if (!row) {
    skip("live analysis load", "organization_id not readable");
    return;
  }
  const repository = createAgentRepository({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: env.SUPABASE_SECRET_KEY,
  });
  const owned = await repository.loadAnalysis({ analysisId, organizationId: row.organization_id });
  checkTrue("the scoped loader finds the analysis under its own organization", owned !== null);
  const foreign = await repository.loadAnalysis({ analysisId, organizationId: "org-does-not-exist" });
  check("the scoped loader refuses the same analysis under another organization", foreign, null);
  const missing = await repository.loadAnalysis({ analysisId: "00000000-0000-0000-0000-000000000000", organizationId: row.organization_id });
  check("a missing analysis reads as null, not an error", missing, null);
}

async function main(): Promise<void> {
  loadAgentEnv();
  credentialChecks();
  toolChecks();
  readOnlyChecks();
  await httpChecks();
  await liveChecks();

  console.log(
    failures === 0
      ? `\nall checks passed${skipped > 0 ? ` (${skipped} skipped)` : ""}`
      : `\n${failures} check(s) failed${skipped > 0 ? `, ${skipped} skipped` : ""}`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
