// The shape the parser writes out is a contract: every phase after this one
// reads this file rather than re-parsing the repository. Treat a change here as
// a change to an interface, not an implementation detail.

export type EdgeKind = "import" | "re-export" | "dynamic";

// What happened to one import, module by module. Every import lands in exactly
// one bucket, so the four counts add up to `importsSeen`. `externalUnresolved`
// is a subset of `outside`, never a fifth bucket.
export type ImportOutcome = "resolved" | "outside" | "excluded" | "failed";

export interface ParsedFile {
  // Repository-relative, forward slashes. This is the node id an edge points at.
  path: string;
  // The directory the file lives in, repository-relative ("." at the root).
  // Everything downstream groups by this, so it is the full parent path, never
  // just the top-level folder.
  folder: string;
  extension: string;
  // True when the file is a module: it has at least one import or export.
  isModule: boolean;
  bytes: number;
  lines: number;
  // sha256 hex of the file contents.
  hash: string;
  // Distinct incoming / outgoing edges, counted after duplicates are removed.
  fanIn: number;
  fanOut: number;
}

export interface Edge {
  source: string;
  target: string;
  kind: EdgeKind;
}

// What a file is in this repository, as decided by the framework adapter that
// matched (or the generic extension role when none did). One role per parsed
// file, kept beside the files rather than on them so the file shape stays about
// the syntax and the role stays about the framework.
export interface FileRole {
  path: string;
  role: string;
}

// A route recovered from the syntax. `method` is null for a page, which has no
// HTTP verb. `file` is the module the route was read from; a route with no file
// is not stored, never invented.
export interface Route {
  framework: string;
  kind: "page" | "api";
  method: string | null;
  path: string;
  file: string;
}

export type SkipReason = "unsupported-extension" | "unreadable" | "parse-failed";

export interface SkippedFile {
  path: string;
  reason: SkipReason;
  // The extension for an unsupported file, or the failure for an unreadable or
  // unparseable one. Absent only where the reason says everything.
  detail?: string;
}

export interface ImportRecord {
  from: string;
  line: number;
  kind: EdgeKind;
  // Absent for a dynamic import whose argument is not a string literal: there
  // is no specifier to report, and guessing one is forbidden.
  specifier?: string;
  outcome: ImportOutcome;
  // The node an import resolved to inside the repository.
  target?: string;
  // Why it did not resolve. Present for every outcome except "resolved".
  reason?: string;
}

export interface Coverage {
  importsSeen: number;
  resolved: number;
  outside: number;
  // The subset of `outside` that is a bare package import TypeScript could not
  // resolve: a dependency the repository declares but that is not present in
  // the analysed tree (an archive carries no node_modules). It is a gap in the
  // external direction, not an internal one, so it is kept out of `failed`.
  externalUnresolved: number;
  excluded: number;
  // Imports that pointed inside the repository and did not resolve to a file.
  // These are the real gaps in the inner graph.
  failed: number;
  byKind: Record<EdgeKind, number>;
  // Acceptance numbers for barrel files: how many re-exports were seen against
  // how many became edges. A gap always appears in one of the record lists.
  reExportsFound: number;
  reExportsResolved: number;
  // Every unresolved import, kept in full: a silent gap is the one failure this
  // parser is built to avoid.
  failures: ImportRecord[];
  // Bounded samples. External packages and assets are expected, so counting
  // them is enough; a handful of examples shows what was meant.
  examples: {
    outside: ImportRecord[];
    excluded: ImportRecord[];
  };
}

export interface ParseCounts {
  found: number;
  parsed: number;
  skipped: number;
}

export interface ParseResult {
  version: 1;
  // The repository directory name only, so the file is portable.
  root: string;
  parsedAt: string;
  adapter: string;
  counts: ParseCounts;
  files: ParsedFile[];
  edges: Edge[];
  roles: FileRole[];
  routes: Route[];
  skipped: SkippedFile[];
  coverage: Coverage;
}
