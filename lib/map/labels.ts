// Labels for nodes and rows. A label is the shortest thing that is still
// unique among what is on screen, so a long path does not read as an important
// module.

import type { MapNode } from "@/lib/map/fold";

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function segmentCount(folder: string): number {
  return folder === "." ? 0 : folder.split("/").length;
}

// Node labels. Deepest folders get first pick of their short names; shallower
// ones extend into their parent path only when the short name is taken. Root
// carries the repository name so it points at something real.
export function resolveNodeLabels(
  nodes: MapNode[],
  rootLabel: string,
): Map<string, string> {
  const used = new Set<string>();
  const labels = new Map<string, string>();
  const order = [...nodes].sort(
    (a, b) =>
      segmentCount(b.id) - segmentCount(a.id) || a.id.localeCompare(b.id),
  );

  for (const node of order) {
    if (node.id === ".") {
      used.add(rootLabel);
      labels.set(node.id, rootLabel);
      continue;
    }
    const parts = node.id.split("/");
    let label: string | undefined;
    for (let take = 1; take <= parts.length; take++) {
      const candidate = parts.slice(parts.length - take).join("/");
      if (!used.has(candidate)) {
        label = candidate;
        break;
      }
    }
    const final = label ?? node.id;
    used.add(final);
    labels.set(node.id, final);
  }

  return labels;
}