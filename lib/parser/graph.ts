import type { Edge } from "./types";

// Graph arithmetic is pure: a file list and an edge list in, numbers out. No
// fetching, nothing to mock, so it can be checked on its own.

// Duplicates removed by (source, target, kind). Importing the same module twice
// is one connection.
export function dedupeEdges(edges: readonly Edge[]): Edge[] {
  const seen = new Set<string>();
  const unique: Edge[] = [];
  for (const edge of edges) {
    const key = `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(edge);
  }
  unique.sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.kind.localeCompare(b.kind),
  );
  return unique;
}

export interface Degrees {
  fanIn: number;
  fanOut: number;
}

export function computeDegrees(
  paths: readonly string[],
  edges: readonly Edge[],
): Map<string, Degrees> {
  const degrees = new Map<string, Degrees>();
  for (const path of paths) degrees.set(path, { fanIn: 0, fanOut: 0 });
  for (const edge of edges) {
    const source = degrees.get(edge.source);
    if (source) source.fanOut += 1;
    const target = degrees.get(edge.target);
    if (target) target.fanIn += 1;
  }
  return degrees;
}
