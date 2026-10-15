// The transitive walk behind blast radius and dependency chain. It is one walk
// with a direction argument: inward along incoming edges answers "what breaks
// if this changes", outward along outgoing edges answers "what does this need".
// Pure over the edge list, so both return the moment they are asked.

import type { Edge } from "@/lib/parser/types";

export type WalkDirection = "in" | "out";

export interface WalkLevel {
  // 1 is the file's direct neighbours, 2 their neighbours, and so on.
  depth: number;
  paths: string[];
}

// Walk out from `start`, returning one level per step out to `maxDepth`. A file
// is reported at the nearest step that reaches it and never twice, and the
// start never appears in its own result.
export function walkGraph(
  start: string,
  edges: readonly Edge[],
  direction: WalkDirection,
  maxDepth: number,
): WalkLevel[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = direction === "out" ? edge.source : edge.target;
    const to = direction === "out" ? edge.target : edge.source;
    const list = adjacency.get(from);
    if (list) list.push(to);
    else adjacency.set(from, [to]);
  }

  const seen = new Set<string>([start]);
  const levels: WalkLevel[] = [];
  let frontier: string[] = [start];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const reachable = new Set<string>();
    for (const path of frontier) {
      for (const next of adjacency.get(path) ?? []) {
        if (!seen.has(next)) reachable.add(next);
      }
    }
    if (reachable.size === 0) break;
    const paths = [...reachable].sort((a, b) => a.localeCompare(b));
    for (const path of paths) seen.add(path);
    levels.push({ depth, paths });
    frontier = paths;
  }

  return levels;
}
