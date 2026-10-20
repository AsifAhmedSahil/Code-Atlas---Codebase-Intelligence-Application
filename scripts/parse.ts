import path from "node:path";
import { parseRepository } from "../lib/parser";
import { readParseResult, writeParseResult } from "../lib/parser/io";
import type { EdgeKind, ImportRecord, ParseResult } from "../lib/parser/types";

interface CliArgs {
  directory: string;
  out?: string;
}

const HELP = `reposcope parse — read a repository into files and edges

usage: pnpm parse [directory] [--out <file>]

  directory   repository to parse (default: current directory)
  --out, -o   write the full result to this file, then read it back to check it
`;

function parseArgs(argv: readonly string[]): CliArgs {
  let directory = ".";
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out" || arg === "-o") {
      out = argv[index + 1];
      if (!out) throw new Error("--out needs a file path");
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      directory = arg;
    }
  }
  return { directory, out };
}

function groupBy<T, K extends string>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const bucket = groups.get(key(item));
    if (bucket) bucket.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

function report(result: ParseResult, directory: string): string {
  const lines: string[] = [];
  const folders = new Set(result.files.map((file) => file.folder));
  const byKind: Record<EdgeKind, number> = {
    import: 0,
    "re-export": 0,
    dynamic: 0,
  };
  for (const edge of result.edges) byKind[edge.kind] += 1;

  lines.push(`root      ${result.root}  (${path.resolve(directory)})`);
  lines.push(`adapter   ${result.adapter}`);
  lines.push("");
  lines.push("files");
  lines.push(`  found     ${result.counts.found}`);
  lines.push(`  parsed    ${result.counts.parsed}`);
  lines.push(`  skipped   ${result.counts.skipped}`);
  lines.push(`  folders   ${folders.size} distinct`);
  lines.push("");
  lines.push(`edges     ${result.edges.length}`);
  lines.push(`  import ${byKind.import}   re-export ${byKind["re-export"]}   dynamic ${byKind.dynamic}`);

  const topBy = (direction: "fanIn" | "fanOut", label: string): void => {
    const ranked = result.files
      .filter((file) => file[direction] > 0)
      .sort((a, b) => b[direction] - a[direction] || a.path.localeCompare(b.path))
      .slice(0, 5);
    if (ranked.length === 0) return;
    lines.push(`  top ${label}`);
    for (const file of ranked) {
      lines.push(`    ${String(file[direction]).padStart(3)}  ${file.path}`);
    }
  };
  topBy("fanIn", "fan-in");
  topBy("fanOut", "fan-out");

  const coverage = result.coverage;
  lines.push("");
  lines.push("coverage");
  lines.push(`  imports seen   ${coverage.importsSeen}`);
  lines.push(`  resolved       ${coverage.resolved}`);
  lines.push(`  outside        ${coverage.outside}`);
  lines.push(`    external     ${coverage.externalUnresolved} unresolved package imports`);
  lines.push(`  excluded       ${coverage.excluded}`);
  lines.push(`  failed         ${coverage.failed}`);
  lines.push(`  re-exports     found ${coverage.reExportsFound}, resolved ${coverage.reExportsResolved}`);

  if (result.roles.length > 0) {
    lines.push("");
    lines.push(`roles     ${result.roles.length}`);
    const roleGroups = groupBy(result.roles, (role) => role.role);
    for (const [role, items] of [...roleGroups.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    )) {
      lines.push(`  ${role.padEnd(16)} ${items.length}`);
    }
  }

  lines.push("");
  lines.push(`routes    ${result.routes.length}`);
  for (const route of result.routes.slice(0, 20)) {
    lines.push(`  ${(route.method ?? "PAGE").padEnd(7)} ${route.path}   (${route.file})`);
  }
  if (result.routes.length > 20) {
    lines.push(`  ... and ${result.routes.length - 20} more`);
  }

  const skippedGroups = groupBy(result.skipped, (file) => file.reason);
  if (skippedGroups.size > 0) {
    lines.push("");
    lines.push("skipped files");
    for (const [reason, items] of [...skippedGroups.entries()].sort()) {
      lines.push(`  ${reason}: ${items.length}`);
      for (const item of items.slice(0, 5)) {
        const detail = item.detail ? `  (${item.detail})` : "";
        lines.push(`    ${item.path}${detail}`);
      }
      if (items.length > 5) lines.push(`    ... and ${items.length - 5} more`);
    }
  }

  lines.push("");
  lines.push("unresolved imports");
  if (coverage.failures.length === 0) {
    lines.push("  none");
  } else {
    for (const failure of coverage.failures.slice(0, 50)) {
      lines.push(`  ${describe(failure)}`);
    }
    if (coverage.failures.length > 50) {
      lines.push(`  ... and ${coverage.failures.length - 50} more`);
    }
  }

  const ignored = result.skipped.filter((file) => file.reason === "unsupported-extension");
  if (ignored.length > 0) {
    lines.push("");
    lines.push(`  (${ignored.length} non-module files skipped with a reason)`);
  }

  return lines.join("\n");
}

function describe(record: ImportRecord): string {
  const specifier = record.specifier ?? "(non-literal dynamic import)";
  const where = `${record.from}:${record.line}`;
  return `${where}  ${record.kind}  "${specifier}"  -> ${record.reason ?? record.outcome}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await parseRepository(args.directory);

  process.stdout.write(`${report(result, args.directory)}\n`);

  if (args.out) {
    const outPath = path.resolve(args.out);
    await writeParseResult(result, outPath);
    const readBack = await readParseResult(outPath);
    const same =
      readBack.counts.found === result.counts.found &&
      readBack.files.length === result.files.length &&
      readBack.edges.length === result.edges.length;
    process.stdout.write(`\nwrote ${outPath}\n`);
    process.stdout.write(
      `read back: found ${readBack.counts.found}, files ${readBack.files.length}, edges ${readBack.edges.length} — ${same ? "types hold" : "MISMATCH"}\n`,
    );
    if (!same) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
