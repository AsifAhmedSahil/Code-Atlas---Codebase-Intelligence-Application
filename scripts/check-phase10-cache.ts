// Regression checks for the Phase 10 explanation cache.
//
// The promise of this phase is not "we call the model once" — it is "the answer
// the reader saw is still there, and asking for it again costs nothing". These
// checks hold that promise to seven cases: a first request persists, a repeat
// does not pay, a fresh page load restores, files and folders do not collide,
// changed content or a changed prompt misses, a broken database is reported
// rather than hidden, and two simultaneous requests still leave one row.
//
// Nothing here talks to the real internet. A loopback server stands in for
// OpenAI, and the global fetch is wrapped so requests to GitHub's API and to
// raw.githubusercontent.com are answered locally while everything else falls
// through untouched. "A fresh page load" is modelled honestly: a second client
// over the same database, with no in-memory answer to lean on.
//
// Run with `npx tsx scripts/check-phase10-cache.ts`.

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

const ORG = "org_cache_check";
const ANALYSIS = "A1";
const SHA = "c0ffee0000000000000000000000000000000000";
const REPO_URL = "https://github.com/example/sample";

// ---------------------------------------------------------------------------
// The stand-in database. It keeps the rows in memory, enforces the same unique
// index the migration creates, and can be told to fail a read or a write. Two
// clients share one database to model two page loads against one Supabase
// project.
// ---------------------------------------------------------------------------

interface ExplanationRow {
  organization_id: string;
  analysis_id: string;
  subject_kind: string;
  subject_id: string;
  content_hash: string;
  model: string;
  prompt_version: string;
  body: string;
}

interface DbError {
  message: string;
  code?: string;
}

interface FakeDb {
  rows: ExplanationRow[];
  reads: number;
  inserts: number;
  readError: string | null;
  writeError: string | null;
  insertDelayMs: number;
}

function sameKey(a: ExplanationRow, b: ExplanationRow): boolean {
  return (
    a.analysis_id === b.analysis_id &&
    a.subject_kind === b.subject_kind &&
    a.subject_id === b.subject_id &&
    a.model === b.model &&
    a.prompt_version === b.prompt_version &&
    a.content_hash === b.content_hash
  );
}

function fieldOf(row: ExplanationRow, column: string): string | undefined {
  return (row as unknown as Record<string, string | undefined>)[column];
}

interface ReadChain {
  eq(column: string, value: string): ReadChain;
  maybeSingle(): Promise<{ data: { body: string } | null; error: DbError | null }>;
}

interface FakeTable {
  select(columns: string): ReadChain;
  insert(row: ExplanationRow): Promise<{ error: DbError | null }>;
}

function fakeClient(db: FakeDb): SupabaseClient<Database> {
  const from = (): FakeTable => ({
    select() {
      const filters: Array<{ column: string; value: string }> = [];
      const chain: ReadChain = {
        eq(column, value) {
          filters.push({ column, value });
          return chain;
        },
        async maybeSingle() {
          db.reads += 1;
          if (db.readError !== null) return { data: null, error: { message: db.readError } };
          const matches = db.rows.filter((row) =>
            filters.every((f) => fieldOf(row, f.column) === f.value),
          );
          if (matches.length > 1) {
            return { data: null, error: { message: "more than one row returned" } };
          }
          const row = matches[0];
          return { data: row ? { body: row.body } : null, error: null };
        },
      };
      return chain;
    },
    async insert(row) {
      db.inserts += 1;
      if (db.insertDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, db.insertDelayMs));
      }
      if (db.writeError !== null) return { error: { message: db.writeError } };
      if (db.rows.some((existing) => sameKey(existing, row))) {
        return { error: { message: "duplicate key value violates unique constraint", code: "23505" } };
      }
      db.rows.push({ ...row });
      return { error: null };
    },
  });
  return { from } as unknown as SupabaseClient<Database>;
}

function rowsFor(db: FakeDb, kind: string, id: string): ExplanationRow[] {
  return db.rows.filter((row) => row.subject_kind === kind && row.subject_id === id);
}

// ---------------------------------------------------------------------------
// The repository the checks reason about: four folders, each with its own file,
// so a folder can be explained without dragging another into the answer.
// ---------------------------------------------------------------------------

function sampleResult(aHash = "ha"): ParseResult {
  return {
    version: 1,
    root: "sample",
    parsedAt: "2026-01-01T00:00:00.000Z",
    adapter: "express",
    counts: { found: 5, parsed: 5, skipped: 0 },
    files: [
      { path: "src/a.ts", folder: "src", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: aHash, fanIn: 1, fanOut: 2 },
      { path: "src/b.ts", folder: "src", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "hb", fanIn: 2, fanOut: 0 },
      { path: "lib/c.ts", folder: "lib", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "hc", fanIn: 1, fanOut: 1 },
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
      { path: "src/a.ts", role: "service", source: "ai" },
      { path: "src/b.ts", role: "repository" },
      { path: "lib/c.ts", role: "util" },
      { path: "pkg/d.ts", role: "util" },
      { path: "app/e.ts", role: "util" },
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

function sampleMap(): FoldedMap {
  return {
    threshold: 2,
    nodes: [
      { id: "src", files: ["src/a.ts", "src/b.ts"], fanIn: 0, fanOut: 0 },
      { id: "lib", files: ["lib/c.ts"], fanIn: 0, fanOut: 0 },
      { id: "pkg", files: ["pkg/d.ts"], fanIn: 0, fanOut: 0 },
      { id: "app", files: ["app/e.ts"], fanIn: 0, fanOut: 0 },
    ],
    edges: [],
    internalEdges: 3,
    fileToNode: { "src/a.ts": "src", "src/b.ts": "src", "lib/c.ts": "lib", "pkg/d.ts": "pkg", "app/e.ts": "app" },
    manifestFiles: [],
  };
}

function source(result: ParseResult): ExplanationSource {
  return {
    analysisId: ANALYSIS,
    organizationId: ORG,
    repoUrl: REPO_URL,
    commitSha: SHA,
    result,
    map: sampleMap(),
  };
}

// ---------------------------------------------------------------------------
// The loopback model server.
// ---------------------------------------------------------------------------

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function startModelServer(): Promise<{ server: Server; port: number; calls: () => number }> {
  let calls = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      calls += 1;
      const answer = `Answer #${calls} for ${req.url ?? "?"}`;
      res.setHeader("content-type", "application/json");
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          id: `chatcmpl-${calls}`,
          object: "chat.completion",
          created: 0,
          model: "gpt-4o-mini",
          choices: [
            { index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 },
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, calls: () => calls });
    });
  });
}

async function main(): Promise<void> {
  const { server, port, calls } = await startModelServer();

  // GitHub is answered from this map. Only the two paths the explanation path
  // can reach are served: the default branch, the commit it points at, and the
  // raw contents of the file being explained.
  const rawFiles: Record<string, string> = {
    "src/a.ts": "import { b } from './b';",
    "src/b.ts": "export const b = 1;",
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://raw.githubusercontent.com/")) {
      const parts = new URL(url).pathname.split("/").filter((part) => part.length > 0);
      const filePath = decodeURIComponent(parts.slice(3).join("/"));
      const body = rawFiles[filePath];
      return body === undefined
        ? new Response("not found", { status: 404 })
        : new Response(body, { status: 200 });
    }
    if (url.startsWith("https://api.github.com/repos/")) {
      if (/\/commits\//.test(url)) return jsonResponse({ sha: SHA });
      return jsonResponse({ default_branch: "main", name: "sample" });
    }
    return realFetch(input, init);
  };

  // Point the model at the loopback server and keep tracing out of the way: this
  // suite is about the cache, and the tracing suite already covers recording.
  process.env.OPENAI_API_KEY = "check-openai-key";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LANGSMITH_TRACING = "false";
  delete process.env.LANGSMITH_API_KEY;

  const { explainSubject, restoreCachedExplanation } = await import("../lib/ai/explain");
  const { folderContentHash } = await import("../lib/ai/cache");
  const { MODEL, PROMPT_VERSION } = await import("../lib/ai/model");

  const db: FakeDb = {
    rows: [],
    reads: 0,
    inserts: 0,
    readError: null,
    writeError: null,
    insertDelayMs: 0,
  };
  const sessionA = fakeClient(db);
  const sessionB = fakeClient(db);
  const plain = sampleResult();

  // --- 1. The first request pays the model once and persists the answer. ---
  const first = await explainSubject(sessionA, source(plain), "folder", "src");
  check("first request succeeds", first.status, "ok");
  check("first request is not served from cache", first.cached, false);
  check("first request asked the model once", calls(), 1);
  check("first request wrote exactly one row", db.rows.length, 1);
  const folderRow = rowsFor(db, "folder", "src")[0];
  check("persisted row names the analysis", folderRow?.analysis_id, ANALYSIS);
  check("persisted row names the organization", folderRow?.organization_id, ORG);
  check("persisted row records the pinned model", folderRow?.model, MODEL);
  check("persisted row records the folder prompt version", folderRow?.prompt_version, PROMPT_VERSION.folder);
  const folderHash = folderRow?.content_hash ?? "";
  check("persisted row records a 64-character content hash", folderHash.length, 64);
  check("persisted row keeps the answer body", folderRow?.body, first.body);

  // --- 2. A second request in the same session costs nothing. ---
  const readsBefore = db.reads;
  const second = await explainSubject(sessionA, source(plain), "folder", "src");
  check("second request is served from cache", second.cached, true);
  check("second request made no model call", calls(), 1);
  check("second request read the cache", db.reads > readsBefore, true);
  check("second request returned the same body", second.body, first.body);
  check("second request wrote no new row", db.rows.length, 1);

  // --- 3. A fresh page load restores from storage, with no model call. ---
  const restored = await restoreCachedExplanation(sessionB, source(plain), "folder", "src");
  check("a fresh session restores an answer", restored !== null, true);
  check("the restored answer is ok", restored?.status, "ok");
  check("the restored answer is marked cached", restored?.cached, true);
  check("the restored answer is the stored body", restored?.body, first.body);
  check("restoring made no model call", calls(), 1);
  check("restoring wrote no row", db.rows.length, 1);

  // --- 4. A genuine miss restores nothing and spends nothing. ---
  const missing = await restoreCachedExplanation(sessionB, source(plain), "folder", "lib");
  check("a miss restores nothing", missing, null);
  check("a miss made no model call", calls(), 1);
  check("a miss wrote no row", db.rows.length, 1);

  // --- 5. Files and folders are cached independently. ---
  const fileAnswer = await explainSubject(sessionA, source(plain), "file", "src/a.ts");
  check("a file can be explained", fileAnswer.status, "ok");
  check("the file answer is not the folder answer", fileAnswer.body !== first.body, true);
  check("the file answer paid one model call", calls(), 2);
  check("there are now two rows", db.rows.length, 2);
  const fileRow = rowsFor(db, "file", "src/a.ts")[0];
  check("the file row records the file prompt version", fileRow?.prompt_version, PROMPT_VERSION.file);
  const folderAgain = await restoreCachedExplanation(sessionA, source(plain), "folder", "src");
  const fileAgain = await restoreCachedExplanation(sessionA, source(plain), "file", "src/a.ts");
  check("the folder still restores its own answer", folderAgain?.body, first.body);
  check("the file restores its own answer", fileAgain?.body, fileAnswer.body);
  check("independence cost no model call", calls(), 2);

  // --- 6. Changed content is a different answer and misses. ---
  const changed = await explainSubject(sessionA, source(sampleResult("h2")), "folder", "src");
  check("changed content is not served from cache", changed.cached, false);
  check("changed content asked the model", calls(), 3);
  check("changed content added a row", db.rows.length, 3);
  check("the two folder rows differ by content hash", new Set(rowsFor(db, "folder", "src").map((row) => row.content_hash)).size, 2);

  // --- 7. The model and the prompt version are part of the key. ---
  // Seed rows that match on content but were written by another model or another
  // prompt: they must not be handed back.
  const libHash = folderContentHash([{ path: "lib/c.ts", hash: "hc" }]);
  db.rows.push({
    organization_id: ORG,
    analysis_id: ANALYSIS,
    subject_kind: "folder",
    subject_id: "lib",
    content_hash: libHash,
    model: MODEL,
    prompt_version: "folder/v0",
    body: "STALE PROMPT ANSWER",
  });
  db.rows.push({
    organization_id: ORG,
    analysis_id: ANALYSIS,
    subject_kind: "file",
    subject_id: "src/b.ts",
    content_hash: "hb",
    model: "gpt-4o",
    prompt_version: PROMPT_VERSION.file,
    body: "STALE MODEL ANSWER",
  });
  const promptMiss = await explainSubject(sessionA, source(plain), "folder", "lib");
  check("another prompt version does not satisfy the cache", promptMiss.body.includes("STALE PROMPT ANSWER"), false);
  check("another prompt version misses and generates", promptMiss.cached, false);
  check("a new folder row was written for the current prompt", rowsFor(db, "folder", "lib").some((row) => row.prompt_version === PROMPT_VERSION.folder), true);
  const modelMiss = await explainSubject(sessionA, source(plain), "file", "src/b.ts");
  check("another model does not satisfy the cache", modelMiss.body.includes("STALE MODEL ANSWER"), false);
  check("another model misses and generates", modelMiss.cached, false);
  check("a new file row was written for the current model", rowsFor(db, "file", "src/b.ts").some((row) => row.model === MODEL), true);
  check("the two key misses each paid the model", calls(), 5);

  // --- 8. A read failure is reported, not papered over. ---
  db.readError = "connection reset by peer";
  const readsBeforeError = calls();
  const readFailure = await explainSubject(sessionA, source(plain), "folder", "src");
  check("a read failure is an error, not an answer", readFailure.status, "error");
  check("the read failure is named", readFailure.message?.includes("Could not read the explanation cache"), true);
  check("a read failure does not claim the cache", readFailure.cached, false);
  check("a read failure spends no model call", calls(), readsBeforeError);
  const restoreFailure = await restoreCachedExplanation(sessionB, source(plain), "folder", "src");
  check("a restore read failure is reported", restoreFailure?.status, "error");
  check("the restore read failure is named", restoreFailure?.message?.includes("Could not read the explanation cache"), true);
  db.readError = null;

  // --- 9. A write failure is reported and never claimed as cached. ---
  db.writeError = "permission denied for table explanations";
  const callsBeforeWrite = calls();
  const writeFailure = await explainSubject(sessionA, source(plain), "folder", "pkg");
  check("a write failure is an error", writeFailure.status, "error");
  check("the write failure is named", writeFailure.message?.includes("Could not write the explanation cache"), true);
  check("a write failure never claims the cache", writeFailure.cached, false);
  check("a write failure did reach the model", calls() > callsBeforeWrite, true);
  check("a failed write left no row", rowsFor(db, "folder", "pkg").length, 0);

  // A concurrent duplicate is a late cache hit, not a write failure.
  db.writeError = null;
  const rowsBeforeRace = db.rows.length;
  const insertsBeforeRace = db.inserts;
  db.insertDelayMs = 25;
  const [raceA, raceB] = await Promise.all([
    explainSubject(sessionA, source(plain), "folder", "app"),
    explainSubject(sessionB, source(plain), "folder", "app"),
  ]);
  db.insertDelayMs = 0;

  // --- 10. Simultaneous requests leave exactly one row. ---
  check("both simultaneous requests succeed", [raceA.status, raceB.status], ["ok", "ok"]);
  check("both simultaneous requests returned an answer", raceA.body.length > 0 && raceB.body.length > 0, true);
  check("both simultaneous requests did try to write", db.inserts - insertsBeforeRace, 2);
  check("simultaneous requests left one row for the key", rowsFor(db, "folder", "app").length, 1);
  check("simultaneous requests added one row overall", db.rows.length, rowsBeforeRace + 1);

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
