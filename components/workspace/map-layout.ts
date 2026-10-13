// Deterministic canvas layout. Given the folded map and an expansion state,
// every node gets a size and a position, and the same inputs always produce
// the same picture. Sizes come first so dagre can pack the graph without
// overlap; positions follow from them.

import dagre from "@dagrejs/dagre";

import type { MapEdge, MapNode } from "@/lib/map/fold";

export type Expanded = ReadonlySet<string>;

export interface NodeSize {
  width: number;
  height: number;
}

// An open folder becomes a panel: a header and up to a cap of rows. When a
// folder holds more files than fit, the panel keeps this height and the rows
// scroll inside it, so the canvas never grows without limit.
export const PANEL_W = 250;
export const PANEL_HEADER_H = 44;
export const ROW_H = 24;
export const MAX_ROWS = 10;

// Height carries fan-in (how many things depend on the module), width comes
// from the label, so a long name does not read as an important file.
export function closedNodeSize(label: string, fanIn: number): NodeSize {
  const width = Math.max(112, Math.min(Math.ceil(label.length) * 7.6 + 26, 240));
  const height = Math.round(52 + 14 * Math.log2(1 + fanIn));
  return { width, height };
}

export function panelSize(fileCount: number): NodeSize {
  const rows = Math.min(fileCount, MAX_ROWS);
  const height = PANEL_HEADER_H + rows * ROW_H + 4;
  return { width: PANEL_W, height };
}

export function nodeSize(
  node: MapNode,
  label: string,
  expanded: Expanded,
): NodeSize {
  return expanded.has(node.id)
    ? panelSize(node.files.length)
    : closedNodeSize(label, node.fanIn);
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  sizes: Map<string, NodeSize>;
}

export function layoutNodes(
  nodes: MapNode[],
  edges: MapEdge[],
  labels: Record<string, string>,
  expanded: Expanded,
): LayoutResult {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: "LR",
    nodesep: 30,
    ranksep: 90,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const size = nodeSize(node, labels[node.id], expanded);
    graph.setNode(node.id, { width: size.width, height: size.height });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  const sizes = new Map<string, NodeSize>();
  for (const node of nodes) {
    const size = nodeSize(node, labels[node.id], expanded);
    const placed = graph.node(node.id);
    sizes.set(node.id, size);
    positions.set(node.id, {
      x: placed.x - size.width / 2,
      y: placed.y - size.height / 2,
    });
  }
  return { positions, sizes };
}