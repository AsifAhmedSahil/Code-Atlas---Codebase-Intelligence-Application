// Folding turns the flat file graph into a map of folder modules that the
// canvas can hold. It is a pure function over the parse contract: every
// decision comes from the repository's own shape, nothing is picked in
// advance, and the same ParseResult always produces the same FoldedMap.

import type { ParseResult } from "@/lib/parser/types";

export interface MapNode {
  // The folder id, repository-relative ("." is the repository root).
  id: string;
  // Files end up in exactly one node; these are the rows an open panel shows.
  files: string[];
  fanIn: number;
  fanOut: number;
}

export interface MapEdge {
  source: string;
  target: string;
  // The file inside each node the edge actually connects. When a node is open
  // the edge attaches to that file's row rather than to the node as a whole.
  sourceFile: string;
  targetFile: string;
}

export interface FoldedMap {
  // The threshold this map was folded at.
  threshold: number;
  nodes: MapNode[];
  edges: MapEdge[];
  // Edges between two files that ended up in the same node are counted but not
  // drawn: a node is not its own dependency.
  internalEdges: number;
  fileToNode: Record<string, string>;
}

export function parentFolder(folder: string): string | undefined {
  if (folder === ".") return undefined;
  const i = folder.lastIndexOf("/");
  return i === -1 ? "." : folder.slice(0, i);
}

function depth(folder: string): number {
  return folder === "." ? 0 : folder.split("/").length;
}

// Fold at one threshold. Working deepest-first, a directory holding fewer than
// `threshold` files merges into its parent. A merge only feeds the parent, and
// the parent is evaluated later in the same traversal, so no merge at one
// depth can change what another merge at the same depth sees.
function foldAt(
  folderFiles: Map<string, Set<string>>,
  threshold: number,
  fileToNode: Map<string, string>,
  rawEdges: Array<{ source: string; target: string }>,
): { nodes: MapNode[]; edges: MapEdge[]; internalEdges: number } {
  const files = new Map(
    Array.from(folderFiles, ([folder, set]) => [folder, new Set(set)]),
  );
  const order = Array.from(files.keys()).sort((a, b) => depth(b) - depth(a));
  const merged = new Set<string>();

  for (const folder of order) {
    if (folder === "." || merged.has(folder)) continue;
    if ((files.get(folder)?.size ?? 0) >= threshold) continue;
    const parent = parentFolder(folder);
    if (parent === undefined) continue;
    const target = files.get(parent);
    if (!target) continue;
    for (const file of files.get(folder)!) target.add(file);
    merged.add(folder);
  }

  const nodes: MapNode[] = [];
  const byId = new Map<string, MapNode>();
  for (const [folder, set] of files) {
    if (merged.has(folder)) continue;
    const node = { id: folder, files: Array.from(set).sort(), fanIn: 0, fanOut: 0 };
    nodes.push(node);
    byId.set(folder, node);
    for (const file of node.files) fileToNode.set(file, folder);
  }

  const edges: MapEdge[] = [];
  let internalEdges = 0;
  for (const e of rawEdges) {
    const source = fileToNode.get(e.source);
    const target = fileToNode.get(e.target);
    if (source === undefined || target === undefined) continue;
    if (source === target) {
      internalEdges++;
      continue;
    }
    edges.push({ source, target, sourceFile: e.source, targetFile: e.target });
  }

  for (const e of edges) {
    byId.get(e.source)!.fanOut++;
    byId.get(e.target)!.fanIn++;
  }

  edges.sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.sourceFile.localeCompare(b.sourceFile) ||
      a.targetFile.localeCompare(b.targetFile),
  );

  return { nodes, edges, internalEdges };
}

// Fold until the map is small enough to read, using the lowest threshold that
// gets there. `maxNodes` is a size for the canvas, not a shape for the code:
// the repository decides the depth.
export function foldMap(
  result: ParseResult,
  maxNodes = 22,
  startThreshold = 2,
): FoldedMap {
  const folderFiles = new Map<string, Set<string>>();
  for (const file of result.files) {
    let set = folderFiles.get(file.folder);
    if (!set) {
      set = new Set();
      folderFiles.set(file.folder, set);
    }
    set.add(file.path);
  }

  // Every ancestor of a folder exists as a folder too, even with zero direct
  // files, so a lone file can always merge upward until it has company.
  for (const folder of Array.from(folderFiles.keys())) {
    let parent = parentFolder(folder);
    while (parent !== undefined) {
      if (!folderFiles.has(parent)) folderFiles.set(parent, new Set());
      parent = parentFolder(parent);
    }
  }

  const fileToNode = new Map<string, string>();
  const rawEdges = result.edges.map((e) => ({ source: e.source, target: e.target }));

  for (let threshold = startThreshold; ; threshold++) {
    fileToNode.clear();
    const folded = foldAt(folderFiles, threshold, fileToNode, rawEdges);
    if (folded.nodes.length <= maxNodes || threshold >= 12) {
      return {
        threshold,
        nodes: folded.nodes,
        edges: folded.edges,
        internalEdges: folded.internalEdges,
        fileToNode: Object.fromEntries(fileToNode),
      };
    }
  }
}