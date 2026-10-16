import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileKindRole, UNCLASSIFIED_ROLE } from "../roles/taxonomy";
import { detectAdapter } from "./adapters";
import { MODULE_EXTENSIONS } from "./constants";
import type { AdapterContext, AdapterFile, FrameworkAdapter } from "./framework";
import { computeDegrees, dedupeEdges } from "./graph";
import { extractImports } from "./imports";
import { countLines, parentFolder } from "./paths";
import { loadCompilerOptions, resolveImport, type ResolveContext } from "./resolve";
import { isIgnoredDirectoryName, walkRepository } from "./walk";
import type {
  Coverage,
  Edge,
  EdgeKind,
  FileRole,
  ImportRecord,
  ParsedFile,
  ParseResult,
  Route,
  SkippedFile,
} from "./types";

export interface ParseOptions {
  adapter?: FrameworkAdapter;
  ignoredDirectories?: readonly string[];
}

// The whole parser, from a directory path to the contract in `types.ts`. It
// reads the filesystem and nothing else: no network, no framework, no database.
const EXAMPLE_LIMIT = 25;

export async function parseRepository(
  rootPath: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const root = path.resolve(rootPath);
  const stats = await fs.stat(root).catch(() => null);
  if (!stats || !stats.isDirectory()) {
    throw new Error(`not a directory: ${rootPath}`);
  }

  const extraIgnored = options.ignoredDirectories ?? [];
  const walk = await walkRepository(root, extraIgnored);

  const files: ParsedFile[] = [];
  const skipped: SkippedFile[] = [];
  const contentByPath = new Map<string, string>();
  const importsByFile = new Map<string, ReturnType<typeof extractImports>>();

  for (const walked of walk.files) {
    if (!MODULE_EXTENSIONS.has(walked.extension)) {
      skipped.push({
        path: walked.relativePath,
        reason: "unsupported-extension",
        detail: walked.extension || "(no extension)",
      });
      continue;
    }

    let content: string;
    try {
      content = await fs.readFile(walked.absolutePath, "utf8");
    } catch (error) {
      skipped.push({
        path: walked.relativePath,
        reason: "unreadable",
        detail: messageOf(error),
      });
      continue;
    }

    let extracted: ReturnType<typeof extractImports>;
    try {
      extracted = extractImports(walked.absolutePath, content);
    } catch (error) {
      skipped.push({
        path: walked.relativePath,
        reason: "parse-failed",
        detail: messageOf(error),
      });
      continue;
    }

    contentByPath.set(walked.relativePath, content);
    importsByFile.set(walked.relativePath, extracted);
    files.push({
      path: walked.relativePath,
      folder: parentFolder(walked.relativePath),
      extension: walked.extension,
      isModule: extracted.isModule,
      bytes: Buffer.byteLength(content, "utf8"),
      lines: countLines(content),
      hash: createHash("sha256").update(content, "utf8").digest("hex"),
      fanIn: 0,
      fanOut: 0,
    });
  }

  // The adapter is chosen once the tree is read: a dependency in package.json
  // decides most repositories, and the file layout decides the rest. A caller
  // may force one, and then nothing is detected.
  const packages = await readPackages(root);
  const adapterFiles: AdapterFile[] = files.map((file) => ({
    path: file.path,
    extension: file.extension,
    content: contentByPath.get(file.path) ?? "",
  }));
  const adapterContext: AdapterContext = { files: adapterFiles, packages };
  const adapter: FrameworkAdapter = options.adapter ?? detectAdapter(adapterContext);

  // Every parsed file gets exactly one role: the adapter's if it claimed the
  // file, and — only when no adapter was detected — the generic extension role.
  // A repository a framework claimed never falls back to extension categories;
  // a file the adapter did not recognize is honestly "unclassified".
  const roles: FileRole[] = adapterFiles.map((file) => ({
    path: file.path,
    role:
      adapter.role(file) ??
      (adapter.name === "none"
        ? fileKindRole(file.path, file.extension)
        : UNCLASSIFIED_ROLE),
  }));

  // Every route points at a file that was parsed; one that does not is dropped,
  // never stored.
  const routes: Route[] = adapter
    .routes(adapterContext)
    .filter((route) => contentByPath.has(route.file))
    .map((route) => ({ framework: adapter.name, ...route }))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.file.localeCompare(b.file) ||
        (a.method ?? "").localeCompare(b.method ?? ""),
    );

  const nodeByPath = new Map<string, string>();
  for (const file of files) nodeByPath.set(file.path.toLowerCase(), file.path);

  // The compiler options are read once: the resolver needs them, and their
  // `paths` keys are the aliases that tell an internal bare import from a
  // package one.
  const compilerOptions = loadCompilerOptions(root);
  const resolveContext: ResolveContext = {
    root,
    options: compilerOptions,
    aliases: Object.keys(compilerOptions.paths ?? {}),
    nodeByPath,
    isIgnored: (relativePath: string) =>
      relativePath.split("/").some((segment) => isIgnoredDirectoryName(segment)),
  };

  const rawEdges: Edge[] = [];
  const records: ImportRecord[] = [];

  for (const file of files) {
    const extracted = importsByFile.get(file.path);
    if (!extracted) continue;
    for (const found of extracted.imports) {
      if (found.specifier === null) {
        records.push({
          from: file.path,
          line: found.line,
          kind: found.kind,
          outcome: "failed",
          reason: "non-literal-specifier",
        });
        continue;
      }

      const resolution = resolveImport(
        found.specifier,
        path.join(root, file.path),
        resolveContext,
      );
      const record: ImportRecord = {
        from: file.path,
        line: found.line,
        kind: found.kind,
        specifier: found.specifier,
        outcome: resolution.outcome,
      };
      if (resolution.target !== undefined) record.target = resolution.target;
      if (resolution.reason !== undefined) record.reason = resolution.reason;
      records.push(record);

      if (resolution.outcome === "resolved" && resolution.target !== undefined) {
        rawEdges.push({
          source: file.path,
          target: resolution.target,
          kind: found.kind,
        });
      }
    }
  }

  const edges = dedupeEdges(rawEdges);
  const degrees = computeDegrees(
    files.map((file) => file.path),
    edges,
  );
  for (const file of files) {
    const degree = degrees.get(file.path);
    if (degree) {
      file.fanIn = degree.fanIn;
      file.fanOut = degree.fanOut;
    }
  }

  skipped.sort((a, b) => a.path.localeCompare(b.path));

  const counts = {
    found: walk.files.length,
    parsed: files.length,
    skipped: skipped.length,
  };
  if (counts.found !== counts.parsed + counts.skipped) {
    throw new Error(
      `counts do not add up: found ${counts.found}, parsed ${counts.parsed}, skipped ${counts.skipped}`,
    );
  }

  return {
    version: 1,
    root: path.basename(root),
    parsedAt: new Date().toISOString(),
    adapter: adapter.name,
    counts,
    files,
    edges,
    roles,
    routes,
    skipped,
    coverage: summarize(records),
  };
}

// The dependency names a repository declares. A missing or unparseable
// package.json is not an error — it just means the adapters fall back to reading
// the file layout.
async function readPackages(root: string): Promise<ReadonlySet<string>> {
  const packages = new Set<string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  } catch {
    return packages;
  }
  if (typeof parsed !== "object" || parsed === null) return packages;
  const groups = parsed as Record<string, unknown>;
  for (const key of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const group = groups[key];
    if (typeof group !== "object" || group === null) continue;
    for (const name of Object.keys(group as Record<string, unknown>)) {
      packages.add(name);
    }
  }
  return packages;
}

function summarize(records: readonly ImportRecord[]): Coverage {
  const byKind: Record<EdgeKind, number> = {
    import: 0,
    "re-export": 0,
    dynamic: 0,
  };
  const failures: ImportRecord[] = [];
  const outsideExamples: ImportRecord[] = [];
  const excludedExamples: ImportRecord[] = [];
  const seenOutside = new Set<string>();
  const seenExcluded = new Set<string>();

  let resolved = 0;
  let outside = 0;
  let externalUnresolved = 0;
  let excluded = 0;
  let failed = 0;
  let reExportsFound = 0;
  let reExportsResolved = 0;

  for (const record of records) {
    byKind[record.kind] += 1;
    if (record.kind === "re-export") {
      reExportsFound += 1;
      if (record.outcome === "resolved") reExportsResolved += 1;
    }

    switch (record.outcome) {
      case "resolved":
        resolved += 1;
        break;
      case "outside": {
        outside += 1;
        if (record.reason === "external-package-unresolved") externalUnresolved += 1;
        const key = record.specifier ?? "";
        if (outsideExamples.length < EXAMPLE_LIMIT && !seenOutside.has(key)) {
          seenOutside.add(key);
          outsideExamples.push(record);
        }
        break;
      }
      case "excluded": {
        excluded += 1;
        const key = `${record.from}\u0000${record.specifier ?? ""}`;
        if (excludedExamples.length < EXAMPLE_LIMIT && !seenExcluded.has(key)) {
          seenExcluded.add(key);
          excludedExamples.push(record);
        }
        break;
      }
      case "failed":
        failed += 1;
        failures.push(record);
        break;
    }
  }

  failures.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);

  return {
    importsSeen: records.length,
    resolved,
    outside,
    externalUnresolved,
    excluded,
    failed,
    byKind,
    reExportsFound,
    reExportsResolved,
    failures,
    examples: { outside: outsideExamples, excluded: excludedExamples },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type {
  Coverage,
  Edge,
  FileRole,
  ParsedFile,
  ParseResult,
  Route,
  SkippedFile,
} from "./types";
export { adapterFor, noFrameworkAdapter } from "./adapters";
export type { FrameworkAdapter } from "./framework";
