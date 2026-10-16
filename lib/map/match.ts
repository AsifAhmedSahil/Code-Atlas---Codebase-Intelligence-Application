// Category -> node matching, kept out of the view so it can be tested without a
// DOM. A node matches a category when at least one of its files carries that
// role. The matched files come back too, so an opened folder can highlight just
// the files in the category rather than the whole node.

export interface MatchableNode {
  id: string;
  files: readonly string[];
}

export interface CategoryMatch {
  nodeHasMatch: ReadonlyMap<string, boolean>;
  // The matched files inside each node. A node with no match maps to an empty
  // set, never to undefined, so a caller never has to guess.
  nodeMatched: ReadonlyMap<string, ReadonlySet<string>>;
}

export function matchCategory(
  nodes: readonly MatchableNode[],
  roleByPath: ReadonlyMap<string, string>,
  category: string,
): CategoryMatch {
  const nodeHasMatch = new Map<string, boolean>();
  const nodeMatched = new Map<string, ReadonlySet<string>>();

  for (const node of nodes) {
    const matched = new Set<string>();
    for (const file of node.files) {
      if (roleByPath.get(file) === category) matched.add(file);
    }
    nodeHasMatch.set(node.id, matched.size > 0);
    nodeMatched.set(node.id, matched);
  }

  return { nodeHasMatch, nodeMatched };
}
