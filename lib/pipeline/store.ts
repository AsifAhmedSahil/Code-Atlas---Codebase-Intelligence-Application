// Writing a parse result into the database.
//
// Everything here is a plain row insert scoped to one analysis. Files go in
// first so edges can point at their ids; an edge whose endpoints were not both
// stored is dropped rather than invented, though the parser guarantees both ends
// are parsed files.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ParseResult } from "@/lib/parser/types";
import type { Database } from "@/lib/supabase/database.types";

// PostgREST accepts large arrays, but a bounded chunk keeps the request small and
// a failure local to one batch.
const CHUNK = 500;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function storeAnalysis(
  client: SupabaseClient<Database>,
  options: {
    organizationId: string;
    analysisId: string;
    result: ParseResult;
  },
): Promise<void> {
  const { organizationId, analysisId, result } = options;

  const fileRows = result.files.map((file) => ({
    organization_id: organizationId,
    analysis_id: analysisId,
    path: file.path,
    folder: file.folder,
    extension: file.extension,
    is_module: file.isModule,
    bytes: file.bytes,
    lines: file.lines,
    hash: file.hash,
    fan_in: file.fanIn,
    fan_out: file.fanOut,
  }));

  const fileIdByPath = new Map<string, string>();
  for (const batch of chunks(fileRows, CHUNK)) {
    const { data, error } = await client.from("files").insert(batch).select("id, path");
    if (error) throw new Error(`Could not save files: ${error.message}`);
    for (const row of data ?? []) fileIdByPath.set(row.path, row.id);
  }

  const edgeRows = [];
  for (const edge of result.edges) {
    const sourceFileId = fileIdByPath.get(edge.source);
    const targetFileId = fileIdByPath.get(edge.target);
    if (!sourceFileId || !targetFileId) continue;
    edgeRows.push({
      organization_id: organizationId,
      analysis_id: analysisId,
      source_file_id: sourceFileId,
      target_file_id: targetFileId,
      kind: edge.kind,
    });
  }
  for (const batch of chunks(edgeRows, CHUNK)) {
    const { error } = await client.from("edges").insert(batch);
    if (error) throw new Error(`Could not save edges: ${error.message}`);
  }

  const skippedRows = result.skipped.map((file) => ({
    organization_id: organizationId,
    analysis_id: analysisId,
    path: file.path,
    reason: file.reason,
    detail: file.detail ?? null,
  }));
  for (const batch of chunks(skippedRows, CHUNK)) {
    const { error } = await client.from("skipped_files").insert(batch);
    if (error) throw new Error(`Could not save skipped files: ${error.message}`);
  }

  // Roles and routes both hang off a file id. A role or route whose file was not
  // stored is dropped rather than pointed at nothing.
  const roleRows = result.roles.flatMap((entry) => {
    const fileId = fileIdByPath.get(entry.path);
    if (fileId === undefined) return [];
    return [
      {
        organization_id: organizationId,
        analysis_id: analysisId,
        file_id: fileId,
        role: entry.role,
      },
    ];
  });
  for (const batch of chunks(roleRows, CHUNK)) {
    const { error } = await client.from("file_roles").insert(batch);
    if (error) throw new Error(`Could not save file roles: ${error.message}`);
  }

  const routeRows = result.routes
    .filter((route) => fileIdByPath.has(route.file))
    .map((route) => ({
      organization_id: organizationId,
      analysis_id: analysisId,
      file_id: fileIdByPath.get(route.file) ?? null,
      framework: route.framework,
      kind: route.kind,
      path: route.path,
      method: route.method,
    }));
  for (const batch of chunks(routeRows, CHUNK)) {
    const { error } = await client.from("routes").insert(batch);
    if (error) throw new Error(`Could not save routes: ${error.message}`);
  }
}
