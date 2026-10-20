// The six read-only tools the agent may call, and nothing else.
//
// Every tool is a pure function of the authorised analysis's `ParseResult`. It
// has no database client, no network handle and no way to name a different
// analysis: the scope is fixed by the caller having already resolved the
// credential, so "read another analysis" is not expressible here. That is the
// read-only guarantee at the type level rather than a promise in a comment.
//
// The graph work is the work the canvas already does. Traversal is
// `walkGraph`, neighbours are `neighboursOf`, the summary is
// `mostDependedOn` / `unimportedFiles` / `buildInsights`, roles come from
// `roleByPath`. A tool that reimplemented any of that would be a second graph
// engine and a second source of truth, so the tools here only shape input,
// bound output and name their own limits.

import { roleByPath } from "@/lib/ai/context";
import { CLASSIFIABLE_ROLES, STRUCTURAL_ROLES } from "@/lib/ai/prompt";
import { buildInsights, type Insight } from "@/lib/map/insights";
import { mostDependedOn, neighboursOf, unimportedFiles } from "@/lib/map/detail";
import { walkGraph, type WalkDirection, type WalkLevel } from "@/lib/map/walk";
import type { ParseResult, Route } from "@/lib/parser/types";

export const AGENT_TOOL_NAMES = [
  "analysis_summary",
  "search_files",
  "list_files_by_role",
  "direct_neighbours",
  "transitive_walk",
  "route_table",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export interface ToolSuccess<T> {
  ok: true;
  tool: AgentToolName;
  data: T;
}

export interface ToolFailure {
  ok: false;
  tool: AgentToolName;
  error: string;
}

export type ToolOutcome<T> = ToolSuccess<T> | ToolFailure;

// Bounds shared by the listing tools. A limit is a display decision the tool
// makes and reports, never something a caller can raise without a rebuild: the
// agent gets to see a repository, not to page through it forever.
export const TOOL_LIST_LIMIT = 50;
export const TOOL_MAX_LIST_LIMIT = 100;
export const TOOL_SEARCH_DEFAULT_LIMIT = 20;
export const TOOL_NEIGHBOUR_LIMIT = 100;
// The canvas walks two hops. The agent may ask for more, up to a ceiling that
// keeps one tool call inside a bounded amount of work and output.
export const TOOL_WALK_DEFAULT_DEPTH = 2;
export const TOOL_WALK_MAX_DEPTH = 4;
export const TOOL_WALK_PATH_LIMIT = 200;

function boundedLimit(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), TOOL_MAX_LIST_LIMIT));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: `\`${field}\` is required and must be a non-empty string.` };
  }
  return { ok: true, value: value.trim() };
}

// Builds a validator for one tool's input. Every tool takes an object; a
// caller that sends anything else is refused with the same sentence rather
// than being handed a default.
function inputContract<T>(
  tool: AgentToolName,
  validate: (raw: Record<string, unknown>) => { ok: true; value: T } | { ok: false; error: string },
): (raw: unknown) => { ok: true; value: T } | { ok: false; error: string } {
  return (raw: unknown) => {
    if (!isRecord(raw)) {
      return { ok: false, error: `${tool}: input must be an object with the documented fields.` };
    }
    return validate(raw);
  };
}

// The two tools that take no arguments still refuse a non-object input, so the
// contract is uniform and a stray argument cannot be mistaken for a scope.
type NoArguments = Record<string, never>;

const parseAnalysisSummaryInput = inputContract<NoArguments>("analysis_summary", () => ({
  ok: true,
  value: {},
}));

const parseSearchFilesInput = inputContract<{ query: string; limit: number }>(
  "search_files",
  (raw) => {
    const query = requiredString(raw.query, "query");
    if (!query.ok) return query;
    return { ok: true, value: { query: query.value, limit: boundedLimit(raw.limit, TOOL_SEARCH_DEFAULT_LIMIT) } };
  },
);

const parseListFilesByRoleInput = inputContract<{ role: string; limit: number }>(
  "list_files_by_role",
  (raw) => {
    const role = requiredString(raw.role, "role");
    if (!role.ok) return role;
    return { ok: true, value: { role: role.value.toLowerCase(), limit: boundedLimit(raw.limit, TOOL_LIST_LIMIT) } };
  },
);

const parseDirectNeighboursInput = inputContract<{ path: string }>("direct_neighbours", (raw) => {
  const path = requiredString(raw.path, "path");
  if (!path.ok) return path;
  return { ok: true, value: { path: path.value } };
});

const parseTransitiveWalkInput = inputContract<{
  path: string;
  direction: WalkDirection;
  maxDepth: number;
}>("transitive_walk", (raw) => {
  const path = requiredString(raw.path, "path");
  if (!path.ok) return path;
  const direction = raw.direction;
  if (direction !== "in" && direction !== "out") {
    return {
      ok: false,
      error: "`direction` must be exactly `in` (what depends on this file) or `out` (what this file depends on).",
    };
  }
  const depth = raw.maxDepth === undefined ? TOOL_WALK_DEFAULT_DEPTH : Number(raw.maxDepth);
  if (!Number.isFinite(depth)) {
    return { ok: false, error: "`maxDepth` must be a number." };
  }
  return {
    ok: true,
    value: {
      path: path.value,
      direction,
      maxDepth: Math.max(1, Math.min(Math.floor(depth), TOOL_WALK_MAX_DEPTH)),
    },
  };
});

const parseRouteTableInput = inputContract<NoArguments>("route_table", () => ({
  ok: true,
  value: {},
}));

// A role the parser can assign. Anything outside this set was never a role, so
// asking for it is answered with the set rather than with an empty list that
// would read as "this role has no files".
const ALLOWED_ROLES: ReadonlySet<string> = new Set<string>([
  ...CLASSIFIABLE_ROLES,
  ...STRUCTURAL_ROLES,
]);

function knownRoles(result: ParseResult): Set<string> {
  return new Set(result.roles.map((entry) => entry.role));
}

function describeRoles(roles: ReadonlySet<string>): string {
  return [...roles].sort((a, b) => a.localeCompare(b)).join(", ");
}

function pathExists(result: ParseResult, path: string): boolean {
  return result.files.some((file) => file.path === path);
}

function fileBrief(result: ParseResult, path: string) {
  const file = result.files.find((candidate) => candidate.path === path);
  if (!file) return null;
  const role = roleByPath(result).get(path);
  return { path: file.path, role: role ?? null, fanIn: file.fanIn, fanOut: file.fanOut, lines: file.lines };
}

function capPaths(paths: readonly string[]): { paths: string[]; truncated: boolean } {
  if (paths.length <= TOOL_NEIGHBOUR_LIMIT) return { paths: [...paths], truncated: false };
  return { paths: paths.slice(0, TOOL_NEIGHBOUR_LIMIT), truncated: true };
}

export interface AnalysisSummaryData {
  root: string;
  adapter: string;
  parsedAt: string;
  counts: { found: number; parsed: number; skipped: number };
  imports: { edges: number; coverage: ParseResult["coverage"] };
  routes: { total: number; pages: number; api: number };
  roles: { distinct: number; available: string[] };
  mostDependedOn: { path: string; role: string | null; fanIn: number }[];
  unimportedByNothing: { path: string; role: string | null; fanOut: number }[];
  unimportedTotal: number;
  insights: { kind: Insight["kind"]; sentence: string; total: number; groups: readonly (readonly string[])[] }[];
}

export interface FileBrief {
  path: string;
  role: string | null;
  fanIn: number;
  fanOut: number;
  lines: number;
}

export interface SearchFilesData {
  query: string;
  matched: number;
  ambiguous: boolean;
  files: FileBrief[];
  message: string;
}

export interface ListFilesByRoleData {
  role: string;
  matched: number;
  files: FileBrief[];
  truncated: boolean;
  message: string;
}

export interface DirectNeighboursData {
  path: string;
  dependencies: string[];
  dependents: string[];
  dependencyTotal: number;
  dependentTotal: number;
  truncated: boolean;
}

export interface TransitiveWalkData {
  path: string;
  direction: WalkDirection;
  maxDepth: number;
  levels: WalkLevel[];
  reachableTotal: number;
  truncated: boolean;
}

export interface RouteTableData {
  total: number;
  pages: number;
  api: number;
  truncated: boolean;
  routes: Route[];
  message: string;
}

// The single entry point. `result` is the authorised analysis; nothing below
// this signature can reach any other.
export function runAgentTool(
  result: ParseResult,
  tool: AgentToolName,
  rawInput: unknown,
): ToolOutcome<unknown> {
  switch (tool) {
    case "analysis_summary": {
      const parsed = parseAnalysisSummaryInput(rawInput);
      if (!parsed.ok) return { ok: false, tool, error: parsed.error };
      return { ok: true, tool, data: analysisSummary(result) };
    }
    case "search_files": {
      const parsed = parseSearchFilesInput(rawInput);
      if (!parsed.ok) return { ok: false, tool, error: parsed.error };
      return { ok: true, tool, data: searchFiles(result, parsed.value) };
    }
    case "list_files_by_role": {
      const parsed = parseListFilesByRoleInput(rawInput);
      if (!parsed.ok) return { ok: false, tool, error: parsed.error };
      return { ok: true, tool, data: listFilesByRole(result, parsed.value) };
    }
    case "direct_neighbours": {
      const parsed = parseDirectNeighboursInput(rawInput);
      if (!parsed.ok) return { ok: false, tool, error: parsed.error };
      return { ok: true, tool, data: directNeighbours(result, parsed.value) };
    }
    case "transitive_walk": {
      const parsed = parseTransitiveWalkInput(rawInput);
      if (!parsed.ok) return { ok: false, tool, error: parsed.error };
      return { ok: true, tool, data: transitiveWalk(result, parsed.value) };
    }
    case "route_table": {
      const parsed = parseRouteTableInput(rawInput);
      if (!parsed.ok) return { ok: false, tool, error: parsed.error };
      return { ok: true, tool, data: routeTable(result) };
    }
    default: {
      // Exhaustiveness: an unknown tool name is refused before it can reach a
      // switch arm that might one day exist.
      throw new Error(`Unknown agent tool: ${String(tool)}`);
    }
  }
}

function analysisSummary(result: ParseResult): AnalysisSummaryData {
  const roles = knownRoles(result);
  const depended = mostDependedOn(result.files, TOOL_SEARCH_DEFAULT_LIMIT);
  const unimported = unimportedFiles(result.files);
  const routes = result.routes;
  const insights = buildInsights(result.files, result.edges, () => false);
  const roleMap = roleByPath(result);

  return {
    root: result.root,
    adapter: result.adapter,
    parsedAt: result.parsedAt,
    counts: { ...result.counts },
    imports: { edges: result.edges.length, coverage: result.coverage },
    routes: {
      total: routes.length,
      pages: routes.filter((route) => route.kind === "page").length,
      api: routes.filter((route) => route.kind === "api").length,
    },
    roles: { distinct: roles.size, available: [...roles].sort((a, b) => a.localeCompare(b)) },
    mostDependedOn: depended.map((file) => ({
      path: file.path,
      role: roleMap.get(file.path) ?? null,
      fanIn: file.fanIn,
    })),
    unimportedByNothing: unimported.slice(0, TOOL_SEARCH_DEFAULT_LIMIT).map((file) => ({
      path: file.path,
      role: roleMap.get(file.path) ?? null,
      fanOut: file.fanOut,
    })),
    unimportedTotal: unimported.length,
    // The same four findings the canvas shows, with the same sentences. A tool
    // that invented a fifth would disagree with the map on screen.
    insights: insights.map((insight) => ({
      kind: insight.kind,
      sentence: insight.sentence,
      total: insight.total,
      groups: insight.groups,
    })),
  };
}

function searchFiles(result: ParseResult, input: { query: string; limit: number }): SearchFilesData {
  const needle = input.query.toLowerCase();
  const exact: string[] = [];
  const prefix: string[] = [];
  const substring: string[] = [];

  for (const file of result.files) {
    const path = file.path.toLowerCase();
    if (path === needle) exact.push(file.path);
    else if (path.startsWith(needle)) prefix.push(file.path);
    else if (path.includes(needle)) substring.push(file.path);
  }

  const byPath = (a: string, b: string) => a.localeCompare(b);
  const ranked = [...exact.sort(byPath), ...prefix.sort(byPath), ...substring.sort(byPath)];
  const files = ranked
    .slice(0, input.limit)
    .map((path) => fileBrief(result, path))
    .filter((file): file is FileBrief => file !== null);

  const ambiguous = exact.length === 0 && prefix.length > 1;

  let message: string;
  if (ranked.length === 0) {
    message = `No file in this analysis has a path containing \`${input.query}\`.`;
  } else if (ranked.length === 1) {
    message = `One file matched.`;
  } else if (ambiguous) {
    message = `${ranked.length} files matched by prefix; the answer may not be unique. Use a more specific path.`;
  } else {
    message = `${ranked.length} files matched.`;
  }

  return { query: input.query, matched: ranked.length, ambiguous, files, message };
}

function listFilesByRole(result: ParseResult, input: { role: string; limit: number }): ListFilesByRoleData {
  if (!ALLOWED_ROLES.has(input.role)) {
    throw new UnsupportedRoleError(input.role);
  }

  const present = knownRoles(result);
  const paths = result.roles
    .filter((entry) => entry.role === input.role)
    .map((entry) => entry.path)
    .sort((a, b) => a.localeCompare(b));

  const files = paths
    .slice(0, input.limit)
    .map((path) => fileBrief(result, path))
    .filter((file): file is FileBrief => file !== null);

  const message =
    paths.length === 0
      ? present.has(input.role)
        ? `No file carries the role \`${input.role}\` in this analysis.`
        : `No file carries the role \`${input.role}\` in this analysis. Roles present are: ${describeRoles(present) || "(none)"}.`
      : `${paths.length} files carry the role \`${input.role}\`.`;

  return {
    role: input.role,
    matched: paths.length,
    files,
    truncated: paths.length > files.length,
    message,
  };
}

// Thrown rather than returned so the HTTP layer can distinguish "the caller
// named a role the product does not have" from "the analysis has no such
// role" — the first is a contract violation, the second is an answer.
export class UnsupportedRoleError extends Error {
  readonly requested: string;
  constructor(requested: string) {
    super(
      `\`${requested}\` is not a supported role. Supported roles are: ${describeRoles(ALLOWED_ROLES)}. ` +
        `Roles are never assigned by this tool.`,
    );
    this.name = "UnsupportedRoleError";
    this.requested = requested;
  }
}

function directNeighbours(result: ParseResult, input: { path: string }): DirectNeighboursData {
  if (!pathExists(result, input.path)) {
    throw new UnknownPathError(input.path);
  }
  // The canvas's own neighbours function: same edge semantics, same sorting.
  const neighbours = neighboursOf(input.path, result.edges);
  const dependencies = capPaths(neighbours.dependencies);
  const dependents = capPaths(neighbours.dependents);

  return {
    path: input.path,
    dependencies: dependencies.paths,
    dependents: dependents.paths,
    dependencyTotal: neighbours.dependencies.length,
    dependentTotal: neighbours.dependents.length,
    truncated: dependencies.truncated || dependents.truncated,
  };
}

export class UnknownPathError extends Error {
  readonly requested: string;
  constructor(requested: string) {
    super(
      `\`${requested}\` is not a file in this analysis. Paths are repository-relative with forward slashes; ` +
        `use search_files to find the right one rather than guessing.`,
    );
    this.name = "UnknownPathError";
    this.requested = requested;
  }
}

function transitiveWalk(
  result: ParseResult,
  input: { path: string; direction: WalkDirection; maxDepth: number },
): TransitiveWalkData {
  if (!pathExists(result, input.path)) {
    throw new UnknownPathError(input.path);
  }
  // Delegated whole: the depth ceiling is enforced on the argument, and the
  // walk itself is the canvas's, so a file is reported at the same nearest
  // depth here as it is on the map.
  const levels = walkGraph(input.path, result.edges, input.direction, input.maxDepth);

  let total = 0;
  let truncated = false;
  const capped: WalkLevel[] = [];
  for (const level of levels) {
    if (total >= TOOL_WALK_PATH_LIMIT) {
      truncated = true;
      break;
    }
    const room = TOOL_WALK_PATH_LIMIT - total;
    if (level.paths.length > room) {
      capped.push({ depth: level.depth, paths: level.paths.slice(0, room) });
      total += room;
      truncated = true;
      break;
    }
    capped.push(level);
    total += level.paths.length;
  }

  return {
    path: input.path,
    direction: input.direction,
    maxDepth: input.maxDepth,
    levels: capped,
    reachableTotal: total,
    truncated,
  };
}

function routeTable(result: ParseResult): RouteTableData {
  const routes = result.routes;
  const capped = routes.slice(0, TOOL_MAX_LIST_LIMIT);
  return {
    total: routes.length,
    pages: routes.filter((route) => route.kind === "page").length,
    api: routes.filter((route) => route.kind === "api").length,
    truncated: routes.length > capped.length,
    routes: capped,
    message:
      routes.length === 0
        ? "No routes were recovered from this analysis. A route exists only when its method and full path can be read from the code exactly."
        : `${routes.length} routes were read from the framework's file conventions.`,
  };
}

// Human-readable contracts, kept beside the code so the docs and the tests
// read from the same place the tools do.
export interface ToolContract {
  name: AgentToolName;
  summary: string;
  input: readonly string[];
  output: readonly string[];
  errors: readonly string[];
}

export const TOOL_CONTRACTS: readonly ToolContract[] = [
  {
    name: "analysis_summary",
    summary: "The whole-analysis summary: counts, coverage, roles present, most depended on, entry points, insights.",
    input: [],
    output: ["root", "adapter", "counts", "imports", "routes", "roles", "mostDependedOn", "unimportedByNothing", "insights"],
    errors: ["input is not an object"],
  },
  {
    name: "search_files",
    summary: "Find files whose path contains a substring. Exact, then prefix, then substring matches.",
    input: ["query (string, required, non-empty)", "limit (optional number, max 100)"],
    output: ["query", "matched", "ambiguous", "files[]", "message"],
    errors: ["query missing or empty", "input is not an object"],
  },
  {
    name: "list_files_by_role",
    summary: "Files carrying a supported role. Never assigns or reinterprets a role.",
    input: ["role (string, required, must be a supported role)", "limit (optional number, max 100)"],
    output: ["role", "matched", "files[]", "truncated", "message"],
    errors: ["role missing", "role is not supported", "input is not an object"],
  },
  {
    name: "direct_neighbours",
    summary: "Direct dependencies and dependents of one file, exactly as the canvas computes them.",
    input: ["path (string, required, must exist in the analysis)"],
    output: ["path", "dependencies[]", "dependents[]", "dependencyTotal", "dependentTotal", "truncated"],
    errors: ["path missing", "path is not a file in this analysis", "input is not an object"],
  },
  {
    name: "transitive_walk",
    summary: "Breadth-first walk from a file, inbound or outbound, delegated to the canvas walk.",
    input: ["path (string, required, must exist)", "direction ('in' | 'out', required)", "maxDepth (optional number, 1-4, default 2)"],
    output: ["path", "direction", "maxDepth", "levels[]", "reachableTotal", "truncated"],
    errors: ["path missing", "path is not a file in this analysis", "direction is not 'in' or 'out'", "maxDepth is not a number"],
  },
  {
    name: "route_table",
    summary: "The route table recovered from the framework's conventions, as the canvas shows it.",
    input: [],
    output: ["total", "pages", "api", "truncated", "routes[]", "message"],
    errors: ["input is not an object"],
  },
];
