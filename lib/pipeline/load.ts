// Reading a stored analysis back into the shape the parser produced.
//
// The map, the rail and the pane all read a `ParseResult`; they are not being
// changed to read database rows. So the rows are assembled back into exactly
// that contract here, and everything built against it keeps working on live
// data. Nothing is invented: an edge exists only where both of its endpoints
// were stored, and a missing scalar falls back to what the row can prove.
//
// PostgREST returns at most a thousand rows per request, so the file, edge and
// skipped-file reads page until the last short page rather than silently losing
// the tail of a large repository.

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Coverage,
  Edge,
  EdgeKind,
  FileRole,
  ParseCounts,
  ParsedFile,
  ParseResult,
  Route,
  SkippedFile,
  SkipReason,
} from "@/lib/parser/types";
import type { Database, Json } from "@/lib/supabase/database.types";

const PAGE_SIZE = 1000;

// A page of rows. The builder a caller hands in resolves to more than this, but
// only these two fields are read, so only these two are named.
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

export interface StoredAnalysis {
  id: string;
  status: string;
  stage: string | null;
  stageMessage: string | null;
  error: string | null;
  errorStage: string | null;
  commitSha: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectName: string;
  repoUrl: string | null;
  // Present only once the run is complete; a running or failed run has no map.
  result: ParseResult | null;
}

interface AnalysisHead {
  id: string;
  status: string;
  stage: string | null;
  stage_message: string | null;
  error: string | null;
  error_stage: string | null;
  commit_sha: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  adapter: string | null;
  root: string | null;
  counts: Json | null;
  coverage: Json | null;
  projects: { name: string; repo_url: string } | null;
}

// Restricting a read to one organization, for a caller holding a privileged
// server-side credential. When set, every query below filters on
// `organization_id` — not only the analyses row — so a child row owned by
// another organization cannot be reached through this analysis id either. When
// absent the caller is already row-scoped by its own token and the filter would
// be redundant. This is the boundary behind which the agent's database access
// sits; it is narrow on purpose.
export interface LoadScope {
  organizationId?: string;
}

export async function getStoredAnalysis(
  client: SupabaseClient<Database>,
  id: string,
  scope?: LoadScope,
): Promise<StoredAnalysis | null> {
  const organizationId = scope?.organizationId;

  const headQuery = client
    .from("analyses")
    .select(
      "id, status, stage, stage_message, error, error_stage, commit_sha, started_at, finished_at, created_at, updated_at, adapter, root, counts, coverage, projects ( name, repo_url )",
    )
    .eq("id", id);
  // An analysis in another organization is simply not found here, which is the
  // same answer as one that does not exist: the caller is never told the
  // difference.
  if (organizationId) headQuery.eq("organization_id", organizationId);

  const { data, error } = await headQuery.maybeSingle<AnalysisHead>();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const head = data;
  const base: Omit<StoredAnalysis, "result"> = {
    id: head.id,
    status: head.status,
    stage: head.stage,
    stageMessage: head.stage_message,
    error: head.error,
    errorStage: head.error_stage,
    commitSha: head.commit_sha,
    startedAt: head.started_at,
    finishedAt: head.finished_at,
    createdAt: head.created_at,
    updatedAt: head.updated_at,
    projectName: head.projects?.name ?? head.root ?? "Repository",
    repoUrl: head.projects?.repo_url ?? null,
  };

  if (head.status !== "complete") {
    return { ...base, result: null };
  }

  const fileRows = await readAll<{
    id: string;
    path: string;
    folder: string;
    extension: string | null;
    is_module: boolean;
    bytes: number | null;
    lines: number | null;
    hash: string | null;
    fan_in: number;
    fan_out: number;
  }>((from, to) => {
    const query = client
      .from("files")
      .select("id, path, folder, extension, is_module, bytes, lines, hash, fan_in, fan_out")
      .eq("analysis_id", id);
    if (organizationId) query.eq("organization_id", organizationId);
    return query.order("path", { ascending: true }).range(from, to);
  });

  const pathById = new Map<string, string>();
  const files: ParsedFile[] = fileRows.map((row) => {
    pathById.set(row.id, row.path);
    return {
      path: row.path,
      folder: row.folder,
      extension: row.extension ?? "",
      isModule: row.is_module,
      bytes: row.bytes ?? 0,
      lines: row.lines ?? 0,
      hash: row.hash ?? "",
      fanIn: row.fan_in,
      fanOut: row.fan_out,
    };
  });

  const edgeRows = await readAll<{
    source_file_id: string;
    target_file_id: string;
    kind: string;
  }>((from, to) => {
    const query = client
      .from("edges")
      .select("source_file_id, target_file_id, kind")
      .eq("analysis_id", id);
    if (organizationId) query.eq("organization_id", organizationId);
    return query.range(from, to);
  });

  const edges: Edge[] = [];
  for (const row of edgeRows) {
    const source = pathById.get(row.source_file_id);
    const target = pathById.get(row.target_file_id);
    // An edge with an endpoint that was not stored is not drawn, never guessed.
    if (!source || !target) continue;
    edges.push({ source, target, kind: row.kind as EdgeKind });
  }

  const skippedRows = await readAll<{ path: string; reason: string; detail: string | null }>(
    (from, to) => {
      const query = client
        .from("skipped_files")
        .select("path, reason, detail")
        .eq("analysis_id", id);
      if (organizationId) query.eq("organization_id", organizationId);
      return query.order("path", { ascending: true }).range(from, to);
    },
  );

  const skipped: SkippedFile[] = skippedRows.map((row) => ({
    path: row.path,
    reason: row.reason as SkipReason,
    ...(row.detail === null ? {} : { detail: row.detail }),
  }));

  const roleRows = await readAll<{ file_id: string; role: string; source: string }>((from, to) => {
    const query = client.from("file_roles").select("file_id, role, source").eq("analysis_id", id);
    if (organizationId) query.eq("organization_id", organizationId);
    return query.range(from, to);
  });

  const roles: FileRole[] = [];
  for (const row of roleRows) {
    const path = pathById.get(row.file_id);
    // A role whose file was not stored is not reported, never guessed.
    if (!path) continue;
    // A role the model assigned is marked as such; anything else reads as an
    // adapter's, which is what the parser writes.
    roles.push({ path, role: row.role, source: row.source === "ai" ? "ai" : "adapter" });
  }

  const routeRows = await readAll<{
    file_id: string | null;
    framework: string;
    kind: string;
    path: string;
    method: string | null;
  }>((from, to) => {
    const query = client
      .from("routes")
      .select("file_id, framework, kind, path, method")
      .eq("analysis_id", id);
    if (organizationId) query.eq("organization_id", organizationId);
    return query.order("path", { ascending: true }).range(from, to);
  });

  const routes: Route[] = [];
  for (const row of routeRows) {
    const file = row.file_id === null ? undefined : pathById.get(row.file_id);
    // A route is only shown with the file it was read from.
    if (!file) continue;
    routes.push({
      framework: row.framework,
      kind: row.kind === "page" ? "page" : "api",
      method: row.method,
      path: row.path,
      file,
    });
  }

  const counts = readCounts(head.counts, files.length, skipped.length);
  const coverage = readCoverage(head.coverage, edges);

  const result: ParseResult = {
    version: 1,
    root: head.root ?? base.projectName,
    parsedAt: head.finished_at ?? head.created_at,
    adapter: head.adapter ?? "none",
    counts,
    files,
    edges,
    roles,
    routes,
    skipped,
    coverage,
  };

  return { ...base, result };
}

// The stored counts are the parser's own numbers. When they are absent — an
// older row — they are recomputed from what was actually stored.
function readCounts(json: Json | null, parsed: number, skipped: number): ParseCounts {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const value = json as { found?: unknown; parsed?: unknown; skipped?: unknown };
    if (
      typeof value.found === "number" &&
      typeof value.parsed === "number" &&
      typeof value.skipped === "number"
    ) {
      return { found: value.found, parsed: value.parsed, skipped: value.skipped };
    }
  }
  return { found: parsed + skipped, parsed, skipped };
}

// The stored coverage. When absent, the counts that can be read off the edges
// stand in, so the coverage banner never claims more than the rows can support.
function readCoverage(json: Json | null, edges: readonly Edge[]): Coverage {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    // A row written before `externalUnresolved` existed does not carry it. It is
    // read as zero rather than left absent, so the arithmetic downstream never
    // meets a missing number.
    const stored = json as unknown as Omit<Coverage, "externalUnresolved"> & {
      externalUnresolved?: number;
    };
    return { ...stored, externalUnresolved: stored.externalUnresolved ?? 0 };
  }
  const byKind: Record<EdgeKind, number> = { import: 0, "re-export": 0, dynamic: 0 };
  for (const edge of edges) byKind[edge.kind]++;
  return {
    importsSeen: edges.length,
    resolved: edges.length,
    outside: 0,
    externalUnresolved: 0,
    excluded: 0,
    failed: 0,
    byKind,
    reExportsFound: 0,
    reExportsResolved: 0,
    failures: [],
    examples: { outside: [], excluded: [] },
  };
}
