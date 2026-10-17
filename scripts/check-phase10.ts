// Regression checks for Phase 10 — explaining, caching and tracing.
//
// Everything asserted here is offline: the shape of a prompt, what a formatted
// reply renders to, how a cache key is built, and where in the source the one
// client is constructed and the cache is read. The model itself is never called.
// Not part of the shipped app: run with `npx tsx`.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { folderContentHash } from "../lib/ai/cache";
import {
  fileHash,
  fileNeighbourhood,
  folderContext,
  folderFiles,
  roleByPath,
} from "../lib/ai/context";
import { parseExplanation, type Block } from "../lib/ai/format";
import { aiConfigured, MODEL, PROMPT_VERSION, tracingEnabled } from "../lib/ai/model";
import {
  buildFilePrompt,
  buildFolderPrompt,
  CLASSIFIABLE_ROLES,
  normalizeClassification,
  STRUCTURAL_ROLES,
} from "../lib/ai/prompt";
import { explanationKey } from "../lib/ai/subject";
import type { FoldedMap } from "../lib/map/fold";
import type { ParseResult } from "../lib/parser/types";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  ->  ${JSON.stringify(actual)}`}`);
}

const root = process.cwd();

function source(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function tsFiles(relative: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(next);
    }
  };
  walk(relative);
  return found;
}

function plain(blocks: readonly Block[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind === "bullets") {
      for (const item of block.items) {
        for (const span of item) parts.push(span.text);
      }
    } else {
      for (const span of block.spans) parts.push(span.text);
    }
  }
  return parts.join(" ");
}

function coverage() {
  return {
    importsSeen: 0,
    resolved: 0,
    outside: 0,
    externalUnresolved: 0,
    excluded: 0,
    failed: 0,
    byKind: { import: 0, "re-export": 0, dynamic: 0 } as Record<
      "import" | "re-export" | "dynamic",
      number
    >,
    reExportsFound: 0,
    reExportsResolved: 0,
    failures: [],
    examples: { outside: [], excluded: [] },
  };
}

function sampleResult(): ParseResult {
  return {
    version: 1,
    root: "sample",
    parsedAt: "2026-01-01T00:00:00.000Z",
    adapter: "express",
    counts: { found: 3, parsed: 3, skipped: 0 },
    files: [
      { path: "src/a.ts", folder: "src", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "ha", fanIn: 1, fanOut: 2 },
      { path: "src/b.ts", folder: "src", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "hb", fanIn: 2, fanOut: 0 },
      { path: "lib/c.ts", folder: "lib", extension: ".ts", isModule: true, bytes: 1, lines: 1, hash: "hc", fanIn: 0, fanOut: 1 },
    ],
    edges: [
      { source: "src/a.ts", target: "src/b.ts", kind: "import" },
      { source: "src/a.ts", target: "lib/c.ts", kind: "import" },
      { source: "lib/c.ts", target: "src/b.ts", kind: "import" },
    ],
    roles: [
      { path: "src/a.ts", role: "service", source: "ai" },
      { path: "src/b.ts", role: "repository" },
      { path: "lib/c.ts", role: "util" },
    ],
    routes: [],
    skipped: [],
    coverage: coverage(),
  };
}

function sampleMap(): FoldedMap {
  return {
    threshold: 2,
    nodes: [
      { id: "src", files: ["src/a.ts", "src/b.ts"], fanIn: 0, fanOut: 0 },
      { id: "lib", files: ["lib/c.ts"], fanIn: 0, fanOut: 0 },
    ],
    edges: [],
    internalEdges: 1,
    fileToNode: { "src/a.ts": "src", "src/b.ts": "src", "lib/c.ts": "lib" },
    manifestFiles: [],
  };
}

function main(): void {
  // --- Formatting: the three permitted pieces are rendered, everything else is
  //     dropped, so no stray marker reaches the reader. ---
  const blocks = parseExplanation(
    "A `src/lib/x.ts` file. **bold** and a stray *asterisk*.\n" +
      "- first\n" +
      "- second\n" +
      "# A heading the model should not have written\n" +
      "trailing ` backtick",
  );
  check("format: bullet block present", blocks.some((b) => b.kind === "bullets"), true);
  const text = plain(blocks);
  check("format: no stray backtick, asterisk or hash", /[`*#]/.test(text), false);
  check("format: inline code kept", blocks.some((b) => b.kind === "paragraph" && b.spans.some((s) => s.kind === "code" && s.text === "src/lib/x.ts")), true);
  check("format: bold kept", blocks.some((b) => b.kind === "paragraph" && b.spans.some((s) => s.kind === "bold")), true);

  // --- Prompts: only the paths handed in are named, and lists are bounded. ---
  const filePrompt = buildFilePrompt({
    path: "src/a.ts",
    role: "service",
    adapter: "express",
    contents: "import { b } from './b';",
    dependencies: [{ path: "src/b.ts", role: "repository" }],
    dependents: [],
  });
  check("prompt: names a real dependency with its role", filePrompt.user.includes("src/b.ts (repository)"), true);
  check("prompt: says a list is empty", filePrompt.user.includes("This file is imported by: none."), true);
  check("prompt: carries the contents", filePrompt.user.includes("import { b } from './b';"), true);

  const many = Array.from({ length: 50 }, (_, i) => ({ path: `f${i}.ts`, role: "util" }));
  const bigPrompt = buildFilePrompt({
    path: "x.ts",
    role: "util",
    adapter: "express",
    contents: "",
    dependencies: many,
    dependents: [],
  });
  check("prompt: bounded neighbour list", bigPrompt.user.includes("(10 more not listed)"), true);
  check("prompt: the 41st neighbour is not named", bigPrompt.user.includes("f40.ts"), false);

  const folderPrompt = buildFolderPrompt({
    folder: "src",
    adapter: "express",
    files: [{ path: "src/a.ts", role: "service" }],
    importedFromOutside: ["lib/c.ts"],
    importsOutside: ["src/b.ts"],
    internalEdges: 1,
  });
  check("prompt: folder names its files", folderPrompt.user.includes("src/a.ts (service)"), true);
  check("prompt: folder names an external importer", folderPrompt.user.includes("- lib/c.ts"), true);

  // --- Classification: only non-structural words, and nothing else. ---
  check("classify: accepts a listed role", normalizeClassification(" util.\n"), "util");
  check("classify: accepts declining", normalizeClassification("unclassified"), "unclassified");
  check("classify: refuses a page", normalizeClassification("page"), null);
  check("classify: refuses a controller", normalizeClassification("controller"), null);
  check("classify: refuses a sentence", normalizeClassification("I think this is a util"), null);
  check(
    "classify: no classifiable role is structural",
    CLASSIFIABLE_ROLES.filter((role) => STRUCTURAL_ROLES.has(role)),
    [],
  );

  // --- Cache key: order-independent, content-sensitive. ---
  const one = folderContentHash([{ path: "a.ts", hash: "1" }, { path: "b.ts", hash: "2" }]);
  const two = folderContentHash([{ path: "b.ts", hash: "2" }, { path: "a.ts", hash: "1" }]);
  check("cache: folder hash ignores file order", one === two, true);
  check("cache: folder hash follows content", folderContentHash([{ path: "a.ts", hash: "1" }, { path: "b.ts", hash: "X" }]) === one, false);
  check("cache: explanation key is the tuple", explanationKey("A", "file", "x.ts"), "A\u0000file\u0000x.ts");

  // --- Context: neighbours come only from real edges. ---
  const result = sampleResult();
  const roles = roleByPath(result);
  const neighbourhood = fileNeighbourhood(result, "src/a.ts", roles);
  check("context: dependencies are the outgoing edges", neighbourhood.dependencies, [
    { path: "lib/c.ts", role: "util" },
    { path: "src/b.ts", role: "repository" },
  ]);
  check("context: no dependents for a leaf entry", neighbourhood.dependents, []);
  check("context: role source is read off the roles", roles.get("src/a.ts"), "service");
  check("context: a file's hash is its cache content hash", fileHash(result, "src/a.ts"), "ha");

  const map = sampleMap();
  const folder = folderContext(result, map, "src", roles);
  check("context: folder files", folder?.files, [
    { path: "src/a.ts", role: "service" },
    { path: "src/b.ts", role: "repository" },
  ]);
  check("context: folder imports outside", folder?.importsOutside, ["lib/c.ts"]);
  check("context: folder imported from outside", folder?.importedFromOutside, ["lib/c.ts"]);
  check("context: folder internal edges", folder?.internalEdges, 1);
  check("context: a folder not on the map is null", folderContext(result, map, "nope", roles), null);
  check("context: folder files carry only source hashes", folderFiles(result, map, "src"), [
    { path: "src/a.ts", hash: "ha" },
    { path: "src/b.ts", hash: "hb" },
  ]);

  // --- The pin and the tracing switch. ---
  check("model: pinned exactly", MODEL, "gpt-4o-mini");
  check("model: no moving alias", /[:@]latest|\*|^gpt-4o$/.test(MODEL), false);
  check("prompt: versioned", PROMPT_VERSION.file, "file/v1");

  const savedKey = process.env.OPENAI_API_KEY;
  const savedTracing = process.env.LANGSMITH_TRACING;
  const savedProject = process.env.LANGSMITH_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LANGSMITH_TRACING;
  delete process.env.LANGSMITH_API_KEY;
  check("model: unconfigured without a key", aiConfigured(), false);
  check("model: tracing off by default", tracingEnabled(), false);
  process.env.LANGSMITH_TRACING = "true";
  process.env.LANGSMITH_API_KEY = "x";
  check("model: tracing on when asked and keyed", tracingEnabled(), true);
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  if (savedTracing !== undefined) process.env.LANGSMITH_TRACING = savedTracing;
  if (savedProject !== undefined) process.env.LANGSMITH_API_KEY = savedProject;

  // --- One client, and the cache read inside the traced run. ---
  const aiFiles = tsFiles("lib").concat(tsFiles("app"));
  const constructsClient = aiFiles.filter((file) =>
    /new OpenAI\(/.test(source(file)),
  );
  check("one place constructs the client", constructsClient, ["lib/ai/model.ts"]);
  const readsKey = aiFiles.filter((file) => /process\.env\.OPENAI_API_KEY/.test(source(file)));
  check("one place reads the key", readsKey, ["lib/ai/model.ts"]);

  const explainSrc = source("lib/ai/explain.ts");
  check("explain wraps a traced run", explainSrc.includes("traceable("), true);
  check(
    "the cache read is inside the traced run",
    /traceable\([\s\S]*?readCached\([\s\S]*?generate\(/.test(explainSrc),
    true,
  );

  // --- A re-run clears cached explanations with the rest of the rows. ---
  check(
    "requeue clears explanations",
    source("lib/pipeline/requeue.ts").includes('from("explanations")'),
    true,
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main();
