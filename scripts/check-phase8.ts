// Regression checks for the framework-aware repository map. Each case pins a
// piece of the fix that the reported bug exposed: the rail is the framework's,
// a recognized repository never falls back to extension roles, roles and routes
// survive a round-trip, a re-run clears the stale ones, the category filter
// matches the right nodes, and no framework name leaks into the parser core or
// the browser lexicon. Not part of the shipped app: run with `npx tsx`.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { roleLabel } from "../components/workspace/categories";
import { matchCategory } from "../lib/map/match";
import { readParseResult, writeParseResult } from "../lib/parser/io";
import type { ParseResult } from "../lib/parser/types";
import { clearAnalysisResults } from "../lib/pipeline/requeue";
import { railFor, roleSpecFor, UNCLASSIFIED_ROLE } from "../lib/roles/taxonomy";
import type { Database } from "../lib/supabase/database.types";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  const detail = ok
    ? ""
    : `\n     got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail}`);
}

// Scripts run from the repository root (`npx tsx scripts/...`), so relative
// source reads resolve against the working directory.
const root = process.cwd();

function source(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

// Every `.ts` under a directory, recursively, as repo-relative posix paths.
function tsFiles(relative: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".ts")) found.push(next);
    }
  };
  walk(relative);
  return found;
}

// A ParseResult with the shape the pipeline writes, used to prove the contract
// round-trips roles and routes.
const sample: ParseResult = {
  version: 1,
  root: "sample",
  parsedAt: "2026-01-01T00:00:00.000Z",
  adapter: "nextjs",
  counts: { found: 2, parsed: 2, skipped: 0 },
  files: [
    { path: "src/app/layout.tsx", folder: "src/app", extension: ".tsx", hash: "a", bytes: 10, lines: 1, fanIn: 0, fanOut: 1, isModule: true },
    { path: "src/app/page.tsx", folder: "src/app", extension: ".tsx", hash: "b", bytes: 10, lines: 1, fanIn: 1, fanOut: 0, isModule: true },
  ],
  edges: [{ source: "src/app/layout.tsx", target: "src/app/page.tsx", kind: "import" }],
  roles: [
    { path: "src/app/layout.tsx", role: "layout" },
    { path: "src/app/page.tsx", role: "page-route" },
  ],
  routes: [{ framework: "nextjs", kind: "page", method: null, path: "/", file: "src/app/page.tsx" }],
  skipped: [],
  coverage: {
    importsSeen: 1,
    resolved: 1,
    outside: 0,
    excluded: 0,
    failed: 0,
    reExportsFound: 0,
    reExportsResolved: 0,
    externalUnresolved: 0,
    byKind: { import: 1, "re-export": 0, dynamic: 0 },
    failures: [],
    examples: { outside: [], excluded: [] },
  },
};

async function main(): Promise<void> {
  // --- The rail is the framework's own, in a fixed reading order, and generic
  //     repositories keep the extension categories. ---
  const nextRail = railFor("nextjs").map((spec) => spec.role);
  check("rail: next order", nextRail, [
    "page-route",
    "api-endpoint",
    "server-action",
    "layout",
    "loading-error",
    "component",
    "hook",
    "middleware",
    "metadata",
    "instrumentation",
    "config",
    "test",
    UNCLASSIFIED_ROLE,
  ]);
  check(
    "rail: next has no extension roles",
    nextRail.filter((role) => role === "ts" || role === "tsx" || role === "js"),
    [],
  );
  const noneRail = railFor("none").map((spec) => spec.role);
  check(
    "rail: none has no framework roles",
    noneRail.filter((role) => nextRail.includes(role)),
    [],
  );
  check("rail: none keeps extensions", noneRail.includes("ts"), true);
  check("rail: unclassified ends every framework", railFor("nestjs").at(-1)?.role, UNCLASSIFIED_ROLE);

  // --- Labels come from the role, not the extension. ---
  check("label: layout", roleLabel("nextjs", "layout"), "Layouts");
  check("label: unclassified", roleLabel("nextjs", UNCLASSIFIED_ROLE), "Unclassified");
  check("label: unknown falls through", roleLabel("nextjs", "mystery-role"), "mystery-role");
  check("label: missing spec", roleSpecFor("nextjs", "never"), undefined);

  // --- The browser lexicon imports nothing, so the client bundle never pulls
  //     the parser, a framework adapter, or node:fs in with it. ---
  const taxonomy = source("lib/roles/taxonomy.ts");
  check("purity: taxonomy has no imports", /^\s*import\b/m.test(taxonomy), false);
  check("purity: taxonomy names no node module", /node:/.test(taxonomy), false);

  // --- No framework name leaks into the parser core; it lives in its adapter. ---
  const leaked = tsFiles("lib/parser").filter(
    (file) => !file.endsWith("/next.ts") && /nextjs/i.test(source(file)),
  );
  check("purity: nextjs only in its adapter", leaked, []);

  // --- Roles and routes survive a write and a read. ---
  const dir = mkdtempSync(path.join(tmpdir(), "check-phase8-"));
  try {
    const file = path.join(dir, "result.json");
    await writeParseResult(sample, file);
    const reloaded = await readParseResult(file);
    check("persist: roles survive", reloaded.roles, sample.roles);
    check("persist: routes survive", reloaded.routes, sample.routes);
    check("persist: adapter survives", reloaded.adapter, "nextjs");

    // A role that is not a string is rejected, not read in.
    writeFileSync(file, JSON.stringify({ ...sample, roles: [{ path: "x", role: 7 }] }));
    let rejected = false;
    try {
      await readParseResult(file);
    } catch {
      rejected = true;
    }
    check("persist: bad role rejected", rejected, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // --- A re-run clears the stale roles and routes, before the files they hang
  //     off. ---
  const calls: string[] = [];
  const stub = {
    from(table: string) {
      return {
        delete() {
          calls.push(table);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
  await clearAnalysisResults(stub, "analysis-1");
  check("requeue: clears roles", calls.includes("file_roles"), true);
  check("requeue: clears routes", calls.includes("routes"), true);
  check("requeue: roles before files", calls.indexOf("file_roles") < calls.indexOf("files"), true);
  check("requeue: routes before files", calls.indexOf("routes") < calls.indexOf("files"), true);

  // --- The category filter matches the nodes whose files carry the role. ---
  const nodes = [
    { id: "src/app", files: ["src/app/page.tsx", "src/app/layout.tsx"] },
    { id: "src/lib", files: ["src/lib/money.ts"] },
  ];
  const roleByPath = new Map<string, string>([
    ["src/app/page.tsx", "page-route"],
    ["src/app/layout.tsx", "layout"],
    ["src/lib/money.ts", UNCLASSIFIED_ROLE],
  ]);
  const pageMatch = matchCategory(nodes, roleByPath, "page-route");
  check("filter: page-route hits its node", pageMatch.nodeHasMatch.get("src/app"), true);
  check("filter: page-route misses others", pageMatch.nodeHasMatch.get("src/lib"), false);
  check(
    "filter: matched files",
    [...(pageMatch.nodeMatched.get("src/app") ?? [])],
    ["src/app/page.tsx"],
  );
  const noneMatch = matchCategory(nodes, roleByPath, "middleware");
  check("filter: absent role matches nothing", [...noneMatch.nodeHasMatch.values()], [false, false]);

  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
