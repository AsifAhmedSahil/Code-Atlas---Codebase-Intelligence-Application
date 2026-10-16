// Acceptance check for import resolution and the coverage arithmetic. Builds a
// tiny throwaway repository (a tsconfig alias, a couple of files) and asserts
// what the resolver and the coverage figure report for each kind of specifier.
// Not part of the shipped app: it is a script, run with `npx tsx`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { coverageFigure } from "../lib/map/coverage";
import {
  loadCompilerOptions,
  resolveImport,
  type ResolveContext,
} from "../lib/parser/resolve";
import type { Coverage, ImportOutcome } from "../lib/parser/types";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label}  ->  ${JSON.stringify(actual)}` +
      (ok ? "" : `  (expected ${JSON.stringify(expected)})`),
  );
}

const root = mkdtempSync(path.join(tmpdir(), "check-resolution-"));
try {
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "src", "util.ts"), "export const util = 1;\n");
  writeFileSync(path.join(root, "src", "entry.ts"), "export {};\n");
  writeFileSync(path.join(root, "src", "styles.css"), "a {}\n");
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          allowJs: true,
          resolveJsonModule: true,
          paths: { "@/*": ["./*"] },
        },
      },
      null,
      2,
    ),
  );

  const options = loadCompilerOptions(root);
  const context: ResolveContext = {
    root,
    options,
    aliases: Object.keys(options.paths ?? {}),
    nodeByPath: new Map([
      ["src/entry.ts", "src/entry.ts"],
      ["src/util.ts", "src/util.ts"],
    ]),
    isIgnored: () => false,
  };
  const containingFile = path.join(root, "src", "entry.ts");

  const outcomes: {
    specifier: string;
    outcome: ImportOutcome;
    reason?: string;
    target?: string;
  }[] = [
    { specifier: "./util", outcome: "resolved", target: "src/util.ts" },
    { specifier: "./missing", outcome: "failed", reason: "file-not-found" },
    {
      specifier: "./styles.css",
      outcome: "excluded",
      reason: "not-a-source-module",
      target: "src/styles.css",
    },
    { specifier: "@/src/util", outcome: "resolved", target: "src/util.ts" },
    { specifier: "@/src/nope", outcome: "failed", reason: "module-not-found" },
    { specifier: "react", outcome: "outside", reason: "external-package-unresolved" },
    { specifier: "next/link", outcome: "outside", reason: "external-package-unresolved" },
    { specifier: "@xyflow/react", outcome: "outside", reason: "external-package-unresolved" },
    {
      specifier: "@xyflow/react/dist/style.css",
      outcome: "excluded",
      reason: "not-a-source-module",
    },
    { specifier: "node:fs", outcome: "outside", reason: "node-builtin" },
    { specifier: "lodash.merge", outcome: "outside", reason: "external-package-unresolved" },
  ];

  console.log(`fixture: ${root}`);
  console.log(`aliases: ${context.aliases.join(", ") || "none"}\n`);

  for (const expected of outcomes) {
    const result = resolveImport(expected.specifier, containingFile, context);
    check(`"${expected.specifier}" outcome`, result.outcome, expected.outcome);
    check(`  reason`, result.reason ?? null, expected.reason ?? null);
    if (expected.target !== undefined) {
      check("  target", result.target, expected.target);
    }
  }

  console.log("\ncoverage arithmetic:");
  const fresh = coverageFigure({
    importsSeen: 124,
    resolved: 75,
    outside: 46,
    externalUnresolved: 34,
    excluded: 3,
    failed: 0,
    byKind: { import: 0, "re-export": 0, dynamic: 0 },
    reExportsFound: 0,
    reExportsResolved: 0,
    failures: [],
    examples: { outside: [], excluded: [] },
  });
  check("external = outside - externalUnresolved", fresh.external, 12);
  check("externalUnresolved is reported", fresh.externalUnresolved, 34);
  check("no internal gap -> 100%", fresh.percent, 100);
  check("not partial", fresh.partial, false);

  // A row stored before `externalUnresolved` existed must not turn into NaN.
  const stored = coverageFigure({
    importsSeen: 9,
    resolved: 6,
    outside: 3,
    excluded: 0,
    failed: 3,
    byKind: { import: 0, "re-export": 0, dynamic: 0 },
    reExportsFound: 0,
    reExportsResolved: 0,
    failures: [],
    examples: { outside: [], excluded: [] },
  } as unknown as Coverage);
  check("stale row defaults externalUnresolved to 0", stored.externalUnresolved, 0);
  check("stale row external falls back to outside", stored.external, 3);
  check("stale row percent ignores externals", stored.percent, 67);

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
  if (failures > 0) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
