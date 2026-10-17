// Regression checks for Phase 10 tracing.
//
// Two things must hold no matter what the tracing endpoint does: an explanation
// is still produced, and a repeat is still served from the cache. A third thing
// must hold when tracing is configured correctly: the run actually reaches the
// configured endpoint.
//
// Nothing here talks to the real internet. A loopback server stands in for both
// OpenAI and LangSmith, so the model call and the trace submission are observed
// rather than assumed. The "endpoint is down" case is simulated by overriding
// the LangSmith fetch to reject with the same `fetch failed` error Node raises
// when a host does not resolve — which is what the incident produced.
//
// Run with `npx tsx scripts/check-phase10-tracing.ts`.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExplanationSource } from "../lib/ai/explain";
import type { FoldedMap } from "../lib/map/fold";
import type { ParseResult } from "../lib/parser/types";
import type { Database } from "../lib/supabase/database.types";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  ->  got ${JSON.stringify(actual)}`}`);
}

interface Recorded {
  method: string;
  url: string;
}

function chatCompletion(): unknown {
  return {
    id: "chatcmpl-check",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "The folder holds a service and a repository." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 },
  };
}

function startServer(): Promise<{ server: Server; port: number; requests: Recorded[] }> {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      requests.push({ method: req.method ?? "", url });
      res.setHeader("content-type", "application/json");
      res.statusCode = 200;
      if (url.includes("/chat/completions")) res.end(JSON.stringify(chatCompletion()));
      else if (url.includes("/info")) res.end(JSON.stringify({ version: "0.0.0", instance_flags: {} }));
      else res.end(JSON.stringify({}));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, requests });
    });
  });
}

// A stand-in for the Supabase client: it remembers the last explanation written
// and can hand it back, which is enough to prove the cache short-circuits the
// model. It never touches the network.
interface StubState {
  reads: number;
  inserts: number;
  row: { body: string } | null;
}

interface SelectQuery {
  eq(column: string, value: string): SelectQuery;
  maybeSingle(): Promise<{ data: { body: string } | null; error: null }>;
}

interface Table {
  select(columns: string): SelectQuery;
  insert(row: { body: string }): Promise<{ error: null }>;
}

function stubClient(state: StubState): SupabaseClient<Database> {
  const table: Table = {
    select() {
      const query: SelectQuery = {
        eq() {
          return query;
        },
        async maybeSingle() {
          state.reads += 1;
          return { data: state.row, error: null };
        },
      };
      return query;
    },
    async insert(row) {
      state.inserts += 1;
      state.row = { body: row.body };
      return { error: null };
    },
  };
  return { from: () => table } as unknown as SupabaseClient<Database>;
}

function sampleResult(): ParseResult {
  return {
    version: 1,
    root: "sample",
    parsedAt: "2026-01-01T00:00:00.000Z",
    adapter: "express",
    counts: { found: 2, parsed: 2, skipped: 0 },
    files: [
      { path: "src/a.ts", folder: "src", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "ha", fanIn: 1, fanOut: 1 },
      { path: "src/b.ts", folder: "src", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "hb", fanIn: 1, fanOut: 1 },
    ],
    edges: [{ source: "src/a.ts", target: "src/b.ts", kind: "import" }],
    roles: [
      { path: "src/a.ts", role: "service", source: "ai" },
      { path: "src/b.ts", role: "repository" },
    ],
    routes: [],
    skipped: [],
    coverage: {
      importsSeen: 1,
      resolved: 1,
      outside: 0,
      externalUnresolved: 0,
      excluded: 0,
      failed: 0,
      byKind: { import: 1, "re-export": 0, dynamic: 0 },
      reExportsFound: 0,
      reExportsResolved: 0,
      failures: [],
      examples: { outside: [], excluded: [] },
    },
  };
}

function sampleMap(): FoldedMap {
  return {
    threshold: 2,
    nodes: [{ id: "src", files: ["src/a.ts", "src/b.ts"], fanIn: 0, fanOut: 0 }],
    edges: [],
    internalEdges: 1,
    fileToNode: { "src/a.ts": "src", "src/b.ts": "src" },
    manifestFiles: [],
  };
}

function source(analysisId: string, orgId: string): ExplanationSource {
  return {
    analysisId,
    organizationId: orgId,
    repoUrl: "https://github.com/example/sample",
    commitSha: null,
    result: sampleResult(),
    map: sampleMap(),
  };
}

async function main(): Promise<void> {
  const { server, port, requests } = await startServer();

  // The endpoint and the model both point at the one loopback server. Set before
  // importing the AI modules: the LangSmith client reads its endpoint once, when
  // the module is first loaded, exactly as it does in the running app.
  process.env.OPENAI_API_KEY = "check-openai-key";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LANGSMITH_TRACING = "true";
  process.env.LANGSMITH_API_KEY = "check-langsmith-key";
  process.env.LANGSMITH_PROJECT = "phase10-tracing-check";
  process.env.LANGSMITH_ENDPOINT = `http://127.0.0.1:${port}`;
  // Wait for the root trace to finish posting before the call resolves, so the
  // delivery can be observed deterministically instead of racing a background
  // flusher.
  process.env.LANGSMITH_TRACING_BACKGROUND = "false";

  const { explainSubject } = await import("../lib/ai/explain");
  const { tracingEnabled } = await import("../lib/ai/model");
  const ls = await import("langsmith");

  const openaiCalls = () => requests.filter((r) => r.url.includes("/chat/completions")).length;
  const state: StubState = { reads: 0, inserts: 0, row: null };
  const client = stubClient(state);

  check("tracing is on in this configuration", tracingEnabled(), true);

  // --- 1. Configured correctly: the run reaches the endpoint. ---
  const first = await explainSubject(client, source("A1", "O1"), "folder", "src");
  check("explanation succeeds when tracing is configured", first.status, "ok");
  check("the first answer is not cached", first.cached, false);
  check("the answer body came from the model", first.body.includes("service"), true);
  check("the model was called once", openaiCalls(), 1);

  await ls.RunTree.getSharedClient().flush();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const delivered = requests.some((r) => r.method === "POST" && r.url.includes("/runs"));
  check("the traced run was delivered to the configured endpoint", delivered, true);

  // --- 2. Endpoint unreachable: the explanation must still arrive. ---
  ls.overrideFetchImplementation(async () => {
    throw new TypeError("fetch failed");
  });
  state.row = null; // Force a cache miss so the model is asked again.

  const second = await explainSubject(client, source("A1", "O1"), "folder", "src");
  check("explanation still succeeds when the endpoint is unreachable", second.status, "ok");
  check("an unreachable endpoint does not empty the answer", second.body.length > 0, true);
  check("the model was still reachable for the miss", openaiCalls(), 2);

  // --- 3. The cache is independent of tracing: a repeat makes no model call. ---
  const before = openaiCalls();
  const third = await explainSubject(client, source("A1", "O1"), "folder", "src");
  check("a repeat is served from the cache", third.cached, true);
  check("a cached repeat makes no model call", openaiCalls(), before);
  check("the cached body is unchanged", third.body === second.body, true);

  server.close();

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
