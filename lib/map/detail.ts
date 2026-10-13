// What the detail pane reads. Pure functions over the parse contract: a list of
// files and a list of edges in, numbers and paths out. No fetching, no React,
// nothing to mock. The pane only ever shows paths that exist in the edge list,
// and every count is the length of the list printed underneath it, so the two
// can never disagree.

import type { Edge, ParsedFile } from "@/lib/parser/types";

export interface Neighbours {
  // Files this one imports (its outgoing edges).
  dependencies: string[];
  // Files that import this one (its incoming edges).
  dependents: string[];
}

export function neighboursOf(path: string, edges: readonly Edge[]): Neighbours {
  const dependencies = new Set<string>();
  const dependents = new Set<string>();
  for (const edge of edges) {
    if (edge.source === path) dependencies.add(edge.target);
    if (edge.target === path) dependents.add(edge.source);
  }
  const byPath = (a: string, b: string) => a.localeCompare(b);
  return {
    dependencies: [...dependencies].sort(byPath),
    dependents: [...dependents].sort(byPath),
  };
}

// What the rest of the repository leans on: the files with the most incoming
// edges, most first. Files nothing imports are excluded — they lead the other
// list.
export function mostDependedOn(
  files: readonly ParsedFile[],
  limit: number,
): ParsedFile[] {
  return files
    .filter((file) => file.fanIn > 0)
    .sort((a, b) => b.fanIn - a.fanIn || a.path.localeCompare(b.path))
    .slice(0, limit);
}

// Where reading starts: nothing imports these. Ordering puts the files that
// themselves lean on the most first, since an entry point imports outward while
// a dead leaf does not.
export function unimportedFiles(files: readonly ParsedFile[]): ParsedFile[] {
  return files
    .filter((file) => file.fanIn === 0)
    .sort((a, b) => b.fanOut - a.fanOut || a.path.localeCompare(b.path));
}

export interface FolderImportStats {
  total: number;
  // Files in this folder that at least one file outside it imports — the
  // folder's public surface.
  fromOutside: number;
  // Files imported by another file in the same folder.
  fromWithin: number;
}

// Counted from the raw edge list, because edges between two files that folded
// into the same node are held back from the folded map and would otherwise read
// as zero internal use.
export function folderImportStats(
  nodeFiles: readonly string[],
  nodeId: string,
  fileToNode: Record<string, string>,
  edges: readonly Edge[],
): FolderImportStats {
  const inside = new Set(nodeFiles);
  const external = new Set<string>();
  const internal = new Set<string>();
  for (const edge of edges) {
    if (!inside.has(edge.target)) continue;
    if (fileToNode[edge.source] === nodeId) internal.add(edge.target);
    else external.add(edge.target);
  }
  return {
    total: nodeFiles.length,
    fromOutside: external.size,
    fromWithin: internal.size,
  };
}

