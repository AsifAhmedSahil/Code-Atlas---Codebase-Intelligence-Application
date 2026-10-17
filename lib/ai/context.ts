// Assembles the facts a prompt is built from: the real neighbours of a file or
// folder, each with the role it holds, taken from this repository's own parse
// result. Pure over the parse contract, so the context a prompt shows can be
// asserted without a model. Nothing here fetches or invents a connection: a
// neighbour is a path an edge actually names.

import type { ParseResult } from "../parser/types";
import type { FoldedMap } from "../map/fold";
import type { PromptNeighbour } from "./prompt";

export type RoleMap = Map<string, string>;

export function roleByPath(result: ParseResult): RoleMap {
  const roles: RoleMap = new Map();
  for (const entry of result.roles) roles.set(entry.path, entry.role);
  return roles;
}

export interface FileNeighbourhood {
  dependencies: PromptNeighbour[];
  dependents: PromptNeighbour[];
}

function withRole(paths: readonly string[], roles: RoleMap): PromptNeighbour[] {
  return paths.map((path) => ({ path, role: roles.get(path) ?? "manifest" }));
}

// The file's outgoing edges (what it imports) and incoming edges (what imports
// it), each neighbour carrying its own role. Built only from edges, so a file
// that appears in neither list is never mentioned in a prompt.
export function fileNeighbourhood(
  result: ParseResult,
  path: string,
  roles: RoleMap,
): FileNeighbourhood {
  const dependencies = new Set<string>();
  const dependents = new Set<string>();
  for (const edge of result.edges) {
    if (edge.source === path) dependencies.add(edge.target);
    if (edge.target === path) dependents.add(edge.source);
  }
  const sort = (a: string, b: string) => a.localeCompare(b);
  return {
    dependencies: withRole([...dependencies].sort(sort), roles),
    dependents: withRole([...dependents].sort(sort), roles),
  };
}

export interface FolderContext {
  folder: string;
  files: PromptNeighbour[];
  importedFromOutside: string[];
  importsOutside: string[];
  internalEdges: number;
}

// The folder's own files, the files elsewhere that import into it, the files
// elsewhere it imports, and how many edges stay inside it. Counted from the raw
// edge list, so edges between files that folded into this same node are counted
// as internal rather than lost.
export function folderContext(
  result: ParseResult,
  map: FoldedMap,
  nodeId: string,
  roles: RoleMap,
): FolderContext | null {
  const node = map.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const inside = new Set(node.files);

  const importedFromOutside = new Set<string>();
  const importsOutside = new Set<string>();
  let internalEdges = 0;
  for (const edge of result.edges) {
    const source = inside.has(edge.source);
    const target = inside.has(edge.target);
    if (source && target) internalEdges++;
    else if (target && !source) importedFromOutside.add(edge.source);
    else if (source && !target) importsOutside.add(edge.target);
  }

  const sort = (a: string, b: string) => a.localeCompare(b);
  return {
    folder: nodeId,
    files: node.files.map((path) => ({ path, role: roles.get(path) ?? "manifest" })),
    importedFromOutside: [...importedFromOutside].sort(sort),
    importsOutside: [...importsOutside].sort(sort),
    internalEdges,
  };
}

// The hash a subject's answer is cached under: a file's own content hash, or the
// hash of the folder's files. A file with no stored hash cannot be cached, so
// its key is unavailable and the caller must explain it uncached.
export function fileHash(result: ParseResult, path: string): string | undefined {
  return result.files.find((file) => file.path === path)?.hash;
}

export function folderFiles(
  result: ParseResult,
  map: FoldedMap,
  nodeId: string,
): { path: string; hash: string }[] {
  const node = map.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const byPath = new Map(result.files.map((file) => [file.path, file.hash]));
  const files: { path: string; hash: string }[] = [];
  for (const path of node.files) {
    const hash = byPath.get(path);
    if (hash !== undefined) files.push({ path, hash });
  }
  return files;
}
