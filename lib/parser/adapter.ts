// Framework knowledge is an adapter, not a branch. Nothing in the parsing code
// may check for a framework; when the first real framework is supported, its
// rules live in an object implementing this interface. This phase ships only
// the fallback, which knows nothing.

export interface FrameworkAdapter {
  readonly name: string;
  // Extra directory names to skip beyond the conventional ones. This is where a
  // real adapter would list its own generated output.
  readonly ignoredDirectories?: readonly string[];
}

// Assumes no framework at all: every source file in the tree is a node.
export const noFrameworkAdapter: FrameworkAdapter = Object.freeze({
  name: "none",
});
