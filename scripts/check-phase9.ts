// Acceptance check for CommonJS and the Express adapter. Builds throwaway
// repositories that exercise `require()`, `module.exports` and an Express folder
// layout, and asserts what the parser reports for each. The ESM repository is
// compared against an edge list captured before the change, so "resolution of
// existing imports is unchanged" is a byte-for-byte claim, not a hope. Not part
// of the shipped app: run with `npx tsx`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { coverageFigure } from "../lib/map/coverage";
import { parseRepository } from "../lib/parser";
import { extractImports } from "../lib/parser/imports";
import type { Edge, ParseResult } from "../lib/parser/types";
import { frameworkLabel, isEntryRole, railFor } from "../lib/roles/taxonomy";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label}  ->  ${JSON.stringify(actual)}` +
      (ok ? "" : `  (expected ${JSON.stringify(expected)})`),
  );
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function roleOf(result: ParseResult, file: string): string | undefined {
  return result.roles.find((entry) => entry.path === file)?.role;
}

function edgeList(edges: readonly Edge[]): Edge[] {
  return edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
  }));
}

function edgesFrom(result: ParseResult, source: string, target: string): Edge[] {
  return edgeList(result.edges).filter(
    (edge) => edge.source === source && edge.target === target,
  );
}

// Captured from the parser before CommonJS support was added. The ESM fixture
// below is the one that produced it; if the change moves a single edge, this
// list and the run disagree and the check fails.
const ESM_BASELINE_EDGES: Edge[] = [
  { source: "src/index.ts", target: "src/lib/barrel.ts", kind: "re-export" },
  { source: "src/index.ts", target: "src/lib/helper.ts", kind: "import" },
  { source: "src/index.ts", target: "src/lib/lazy.ts", kind: "dynamic" },
  { source: "src/index.ts", target: "src/lib/thing.ts", kind: "import" },
  { source: "src/index.ts", target: "src/lib/thing.ts", kind: "re-export" },
  { source: "src/index.ts", target: "src/math/add.ts", kind: "import" },
  { source: "src/index.ts", target: "src/side-effect.ts", kind: "import" },
  { source: "src/lib/barrel.ts", target: "src/lib/thing.ts", kind: "re-export" },
  { source: "src/lib/barrel.ts", target: "src/math/add.ts", kind: "re-export" },
  { source: "src/lib/helper.ts", target: "src/math/add.ts", kind: "import" },
];

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "check-phase9-"));
  try {
    // --- ESM only: the change must leave every edge exactly where it was. ---
    const esm = path.join(root, "esm");
    write(
      esm,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          allowJs: true,
          resolveJsonModule: true,
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
        },
      }),
    );
    write(
      esm,
      "src/index.ts",
      [
        'import { helper } from "./lib/helper";',
        'import add from "@/math/add";',
        'import "./side-effect";',
        'import "./styles.css";',
        'import { thing as aliased } from "./lib/thing";',
        "",
        'export * from "./lib/barrel";',
        'export { thing } from "./lib/thing";',
        "",
        'const lazy = import("./lib/lazy");',
        "",
        "export const run = () => helper() + add(1, 2) + Number(aliased) + Number(lazy);",
        "",
      ].join("\n"),
    );
    write(
      esm,
      "src/lib/helper.ts",
      'import { add } from "../math/add";\nexport const helper = () => add(1, 2);\n',
    );
    write(esm, "src/lib/barrel.ts", 'export * from "./thing";\nexport { add } from "../math/add";\n');
    write(esm, "src/lib/thing.ts", "export const thing = 1;\n");
    write(esm, "src/lib/lazy.ts", "export const lazy = 1;\n");
    write(esm, "src/math/add.ts", "export function add(a: number, b: number) { return a + b; }\n");
    write(esm, "src/side-effect.ts", 'console.log("side effect");\n');
    write(esm, "src/styles.css", "a { color: red; }\n");

    const esmResult = await parseRepository(esm);
    check("esm: adapter is none", esmResult.adapter, "none");
    check("esm: edges byte-identical", edgeList(esmResult.edges), ESM_BASELINE_EDGES);
    check("esm: coverage unchanged", esmResult.coverage.importsSeen, 11);
    check("esm: resolved unchanged", esmResult.coverage.resolved, 10);
    check("esm: excluded unchanged", esmResult.coverage.excluded, 1);
    check("esm: byKind unchanged", esmResult.coverage.byKind, {
      import: 6,
      "re-export": 4,
      dynamic: 1,
    });

    // --- Mixed: an ESM import and a require() of the same module, and require
    //     crossing into ESM. The two spellings must collapse to one edge. ---
    const mixed = path.join(root, "mixed");
    write(mixed, "package.json", JSON.stringify({ name: "mixed-fixture" }));
    write(mixed, "src/esm/util.ts", "export const util = 1;\n");
    write(mixed, "src/esm-entry.ts", 'import { util } from "./esm/util";\nexport const entry = util;\n');
    write(mixed, "src/lib-helper.js", "exports.helper = () => 1;\n");
    write(mixed, "src/lib-dep.js", "exports.dep = 2;\n");
    write(mixed, "src/lib-uses-dep.js", 'const dep = require("./lib-dep");\nexports.value = dep;\n');
    write(mixed, "src/cjs-legacy.js", 'const helper = require("./lib-helper");\nmodule.exports = () => helper;\n');
    write(mixed, "src/cjs-uses-esm.js", 'const { util } = require("./esm/util");\nmodule.exports = util;\n');
    write(
      mixed,
      "src/mixed-dup.ts",
      'import { util } from "./esm/util";\nconst again = require("./esm/util");\nexport const mixed = util + Number(Boolean(again));\n',
    );

    const mixedResult = await parseRepository(mixed);
    check("mixed: adapter is none", mixedResult.adapter, "none");
    check("mixed: require edge (same dir)", edgesFrom(mixedResult, "src/lib-uses-dep.js", "src/lib-dep.js").length, 1);
    check("mixed: require edge (nested)", edgesFrom(mixedResult, "src/cjs-legacy.js", "src/lib-helper.js").length, 1);
    check("mixed: require reaches esm", edgesFrom(mixedResult, "src/cjs-uses-esm.js", "src/esm/util.ts").length, 1);
    check(
      "mixed: import + require of the same module is one edge",
      edgesFrom(mixedResult, "src/mixed-dup.ts", "src/esm/util.ts"),
      [{ source: "src/mixed-dup.ts", target: "src/esm/util.ts", kind: "import" }],
    );
    check("mixed: both are reported, one edge", {
      seen: mixedResult.coverage.importsSeen,
      edges: mixedResult.edges.length,
    }, { seen: 6, edges: 5 });
    // The ESM-only files still resolve exactly as before the change.
    check("mixed: esm entry unbroken", edgesFrom(mixedResult, "src/esm-entry.ts", "src/esm/util.ts").length, 1);

    // --- Pure CommonJS: require() targets, a Node builtin, and every require
    //     form the parser refuses to guess at. ---
    const cjs = path.join(root, "cjs");
    write(cjs, "package.json", JSON.stringify({ name: "cjs-fixture" }));
    write(
      cjs,
      "src/index.js",
      'const a = require("./a");\nconst b = require("./b");\nconst fs = require("node:fs");\nmodule.exports = { a, b, fs };\n',
    );
    write(cjs, "src/a.js", 'module.exports = require("./shared");\n');
    write(cjs, "src/b.js", 'exports.b = 2;\nconst shared = require("./shared");\nvoid shared;\n');
    write(cjs, "src/shared.js", "exports.shared = true;\n");
    write(cjs, "src/dead.js", "module.exports = 1;\n");
    write(
      cjs,
      "src/ignored.js",
      [
        'const name = "./a";',
        "const a = require(name);",
        'const b = require("./a", extra);',
        'const resolved = require.resolve("./a");',
        'const viaModule = module.require("./a");',
        "module.exports = { a, b, resolved, viaModule };",
        "",
      ].join("\n"),
    );

    const cjsResult = await parseRepository(cjs);
    check("cjs: adapter is none", cjsResult.adapter, "none");
    check("cjs: require resolves a sibling", edgesFrom(cjsResult, "src/index.js", "src/a.js").length, 1);
    check("cjs: require resolves another sibling", edgesFrom(cjsResult, "src/index.js", "src/b.js").length, 1);
    check("cjs: module.exports = require() still an edge", edgesFrom(cjsResult, "src/a.js", "src/shared.js").length, 1);
    check("cjs: require after a named export is an edge", edgesFrom(cjsResult, "src/b.js", "src/shared.js").length, 1);
    check("cjs: dynamic require ignored", edgesFrom(cjsResult, "src/ignored.js", "src/a.js").length, 0);
    check("cjs: require.resolve ignored (no phantom import)", cjsResult.coverage.importsSeen, 5);
    check("cjs: builtin is outside, not a gap", {
      outside: cjsResult.coverage.outside,
      externalUnresolved: cjsResult.coverage.externalUnresolved,
      failed: cjsResult.coverage.failed,
    }, { outside: 1, externalUnresolved: 0, failed: 0 });
    check("cjs: dead file exports but has no edge", edgesFrom(cjsResult, "src/dead.js", "src/dead.js").length, 0);

    // --- The CommonJS exports a file offers, read straight off the syntax. ---
    const modules = path.join(root, "modules");
    const source = (name: string, content: string) => {
      write(modules, name, content);
      return extractImports(path.join(modules, name), content);
    };

    const literalRequire = source("literal.js", 'const a = require("./a");\n');
    check("require: literal is an import edge", literalRequire.imports, [
      { kind: "import", specifier: "./a", line: 1 },
    ]);
    check("require: sibling template literal is read", source("tmpl.js", "const a = require(`./a`);\n").imports.length, 1);
    check("require: expression template is refused", source("tmpl2.js", "const a = require(`./${x}`);\n").imports.length, 0);
    check("require: variable argument is refused", source("var.js", "const a = require(name);\n").imports.length, 0);
    check("require: extra arguments are refused", source("extra.js", 'require("./a", 1);\n').imports.length, 0);
    check("require: require.resolve is not an edge", source("resolve.js", 'require.resolve("./a");\n').imports.length, 0);
    check("require: module.require is not an edge", source("modreq.js", 'module.require("./a");\n').imports.length, 0);

    check("exports: module.exports default", source("def.js", "module.exports = 1;\n").commonJs, { default: true, named: [] });
    check("exports: object literal is default, names not invented", source("obj.js", "module.exports = { a: 1 };\n").commonJs, { default: true, named: [] });
    check("exports: named in source order, deduped", source("named.js", "exports.a = 1;\nexports.b = 2;\nexports.a = 3;\n").commonJs, { default: false, named: ["a", "b"] });
    check("exports: module.exports.name", source("prop.js", "module.exports.x = 1;\n").commonJs, { default: false, named: ["x"] });
    check("exports: computed name is not guessed", source("computed.js", 'exports["x"] = 1;\n').commonJs, { default: false, named: [] });
    check("exports: reassigning exports is not a default", source("reassign.js", "exports = {};\n").commonJs, { default: false, named: [] });

    check("isModule: plain script is not a module", source("script.js", "const x = 1;\n").isModule, false);
    check("isModule: require-only file is a module", source("req.js", 'const a = require("./a");\n').isModule, true);
    check("isModule: exports-only file is a module", source("exp.js", "exports.a = 1;\n").isModule, true);
    check("isModule: module.exports-only file is a module", source("modexp.js", "module.exports = 1;\n").isModule, true);
    check("isModule: dynamic import is a module", source("dyn.js", 'const a = import("./a");\n').isModule, true);
    check("dynamic import still kind dynamic", source("dyn2.js", 'import("./a");\n').imports, [
      { kind: "dynamic", specifier: "./a", line: 1 },
    ]);

    // --- Express: detected from package.json, roles from the folder layout,
    //     no routes, and a coverage denominator that is no longer zero. ---
    const express = path.join(root, "express-api");
    write(express, "package.json", JSON.stringify({ name: "express-api", dependencies: { express: "4.18.0" } }));
    write(
      express,
      "src/app.js",
      [
        'const express = require("express");',
        'const users = require("./controllers/users");',
        'const health = require("./routes/health");',
        'const auth = require("./middleware/auth");',
        'const db = require("./config/db");',
        'const missing = require("./controllers/missing");',
        "",
        "const app = express();",
        "app.use(auth);",
        'app.get("/users", users.list);',
        'app.get("/health", health);',
        "void db;",
        "void missing;",
        "",
        "module.exports = app;",
        "",
      ].join("\n"),
    );
    write(express, "src/controllers/users.js", 'const service = require("../services/users");\nexports.list = () => service.all();\n');
    write(express, "src/controller/ping.js", "exports.ping = () => 1;\n");
    write(express, "src/routes/health.js", 'module.exports = (req, res) => res.send("ok");\n');
    write(express, "src/route/status.js", "exports.status = () => 1;\n");
    write(express, "src/middleware/auth.js", "module.exports = (req, res, next) => next();\n");
    write(express, "src/services/users.js", 'const repo = require("../repositories/users");\nexports.all = () => repo.all();\n');
    write(express, "src/service/ping.js", "exports.ping = () => 1;\n");
    write(express, "src/repositories/users.js", 'const model = require("../models/user");\nexports.all = () => model.all();\n');
    write(express, "src/models/user.js", "exports.all = () => [];\n");
    write(express, "src/model/session.js", "exports.session = {};\n");
    write(express, "src/config/db.js", "exports.connection = {};\n");

    const expressResult = await parseRepository(express);
    check("express: adapter", expressResult.adapter, "express");
    check("express: routes are not extracted", expressResult.routes, []);
    check("express: real graph, seven edges", expressResult.edges.length, 7);
    check("express: packages are not mistaken for files", {
      outside: expressResult.coverage.outside,
      failed: expressResult.coverage.failed,
      resolved: expressResult.coverage.resolved,
    }, { outside: 1, failed: 1, resolved: 7 });
    check("express: real denominator", expressResult.coverage.importsSeen, 9);
    const expressFigure = coverageFigure(expressResult.coverage);
    check("express: coverage is named, not a hollow 100", {
      percent: expressFigure.percent,
      partial: expressFigure.partial,
    }, { percent: 88, partial: true });

    check("express: role controller (plural dir)", roleOf(expressResult, "src/controllers/users.js"), "controller");
    check("express: role controller (singular dir)", roleOf(expressResult, "src/controller/ping.js"), "controller");
    check("express: role route (plural dir)", roleOf(expressResult, "src/routes/health.js"), "route");
    check("express: role route (singular dir)", roleOf(expressResult, "src/route/status.js"), "route");
    check("express: role middleware", roleOf(expressResult, "src/middleware/auth.js"), "middleware");
    check("express: role service (plural dir)", roleOf(expressResult, "src/services/users.js"), "service");
    check("express: role service (singular dir)", roleOf(expressResult, "src/service/ping.js"), "service");
    check("express: role repository", roleOf(expressResult, "src/repositories/users.js"), "repository");
    check("express: role model (plural dir)", roleOf(expressResult, "src/models/user.js"), "model");
    check("express: role model (singular dir)", roleOf(expressResult, "src/model/session.js"), "model");
    check("express: role config", roleOf(expressResult, "src/config/db.js"), "config");
    check("express: unrecognized file is unclassified", roleOf(expressResult, "src/app.js"), "unclassified");
    check(
      "express: no extension roles",
      [...new Set(expressResult.roles.map((entry) => entry.role))].filter(
        (role) => role === "ts" || role === "tsx" || role === "js",
      ),
      [],
    );

    // --- The rail and labels a browser reads are Extended, not invented. ---
    check("taxonomy: express rail order", railFor("express").map((spec) => spec.role), [
      "controller",
      "route",
      "middleware",
      "service",
      "repository",
      "model",
      "config",
      "unclassified",
    ]);
    check("taxonomy: express label", frameworkLabel("express"), "Express");
    check("taxonomy: a route is an entry role", isEntryRole("route"), true);
    check("taxonomy: a controller is an entry role", isEntryRole("controller"), true);

    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failed`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
