// The insights: four facts read straight off the file and edge lists. No model
// is involved and each kind has one fixed sentence — the panel says what the
// arithmetic shows, nothing more. It explains a codebase; it does not grade one.

import type { Edge, ParsedFile } from "@/lib/parser/types";

export type InsightKind = "unimported" | "common" | "cycle" | "long";

const SENTENCE: Record<InsightKind, string> = {
  unimported: "Nothing in the repository imports these files.",
  common: "An unusual number of files import these.",
  cycle: "These files import each other in a loop.",
  long: "These files are long enough to be hard to read in one pass.",
};

export interface Insight {
  kind: InsightKind;
  sentence: string;
  // Matches found before any display cap, so the header count is the whole
  // story even when the list underneath it is shortened.
  total: number;
  // One group per finding. A list is a single group; each cycle is its own, so
  // a loop reads as a loop rather than as a pile of paths.
  groups: readonly (readonly string[])[];
}

const LIST_LIMIT = 12;
const CYCLE_LIMIT = 20;

// A file this long is worth surfacing on its own. It is a line count, not a
// judgement — the insight says the file is long, not that it is bad.
export const LONG_LINES = 400;

// A file imported more than this far above the average is "unusual". Computed
// from the distribution rather than picked, so it moves with the repository.
const STDDEV_FACTOR = 2;

export function buildInsights(
  files: readonly ParsedFile[],
  edges: readonly Edge[],
  isEntryPoint: (path: string) => boolean,
): Insight[] {
  return [unimported(files, isEntryPoint), common(files), cycles(edges), long(files)].filter(
    (insight) => insight.total > 0,
  );
}

function unimported(
  files: readonly ParsedFile[],
  isEntryPoint: (path: string) => boolean,
): Insight {
  const paths = files
    .filter((file) => file.fanIn === 0 && !isEntryPoint(file.path))
    .sort((a, b) => b.fanOut - a.fanOut || a.path.localeCompare(b.path))
    .map((file) => file.path);
  return list("unimported", paths);
}

function common(files: readonly ParsedFile[]): Insight {
  const imported = files.filter((file) => file.fanIn > 0);
  if (imported.length === 0) return list("common", []);
  const mean = imported.reduce((sum, file) => sum + file.fanIn, 0) / imported.length;
  const variance =
    imported.reduce((sum, file) => sum + (file.fanIn - mean) ** 2, 0) / imported.length;
  const stddev = Math.sqrt(variance);
  // With no spread there is no outlier; the average is not "unusual".
  if (stddev === 0) return list("common", []);
  const threshold = mean + STDDEV_FACTOR * stddev;
  const paths = imported
    .filter((file) => file.fanIn > threshold)
    .sort((a, b) => b.fanIn - a.fanIn || a.path.localeCompare(b.path))
    .map((file) => file.path);
  return list("common", paths);
}

function long(files: readonly ParsedFile[]): Insight {
  const paths = files
    .filter((file) => file.lines >= LONG_LINES)
    .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
    .map((file) => file.path);
  return list("long", paths);
}

function cycles(edges: readonly Edge[]): Insight {
  const adjacency = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.source);
    nodes.add(edge.target);
    const list = adjacency.get(edge.source);
    if (list) list.push(edge.target);
    else adjacency.set(edge.source, [edge.target]);
  }

  const components = stronglyConnected(adjacency, nodes).sort(
    (a, b) => b.length - a.length || a[0].localeCompare(b[0]),
  );

  return {
    kind: "cycle",
    sentence: SENTENCE.cycle,
    total: components.length,
    groups: components.slice(0, CYCLE_LIMIT),
  };
}

function list(kind: InsightKind, paths: readonly string[]): Insight {
  return {
    kind,
    sentence: SENTENCE[kind],
    total: paths.length,
    groups: paths.length > 0 ? [paths.slice(0, LIST_LIMIT)] : [],
  };
}

// Every group of files that can all reach one another. Iterative Tarjan: a real
// repository will overflow a recursive walk long before it runs out of cycles.
function stronglyConnected(
  adjacency: ReadonlyMap<string, readonly string[]>,
  nodes: ReadonlySet<string>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    const frames: { node: string; neighbours: readonly string[]; next: number }[] = [
      { node: root, neighbours: adjacency.get(root) ?? [], next: 0 },
    ];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.next < frame.neighbours.length) {
        const neighbour = frame.neighbours[frame.next];
        frame.next += 1;
        if (!index.has(neighbour)) {
          index.set(neighbour, counter);
          low.set(neighbour, counter);
          counter += 1;
          stack.push(neighbour);
          onStack.add(neighbour);
          frames.push({
            node: neighbour,
            neighbours: adjacency.get(neighbour) ?? [],
            next: 0,
          });
        } else if (onStack.has(neighbour)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(neighbour)!));
        }
        continue;
      }

      const node = frame.node;
      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
      }
      if (low.get(node) === index.get(node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== node);
        if (component.length > 1) {
          components.push(component.sort((a, b) => a.localeCompare(b)));
        }
      }
    }
  }

  return components;
}
