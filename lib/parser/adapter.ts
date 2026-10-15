// Framework knowledge is an adapter, not a branch. Nothing in the parsing code
// may check for a framework; when the first real framework is supported, its
// rules live in an object implementing this interface.
//
// An adapter also says which files a runtime reaches *without* an import. The
// import graph cannot show a framework loading a page, so a file that nothing
// imports is not automatically unused — reporting it as unused would be the
// parser describing the limits of its own view as a finding about the code.

export interface FrameworkAdapter {
  readonly name: string;
  // Extra directory names to skip beyond the conventional ones. This is where a
  // real adapter would list its own generated output.
  readonly ignoredDirectories?: readonly string[];
  // Paths reached from outside the import graph: framework routes, pages,
  // layouts and middleware, and the config files a toolchain loads by name.
  readonly entryPoints?: readonly RegExp[];
}

// Tooling config, reached by whatever reads it rather than by an import. These
// are the same in every repository, framework or not. Framework entry points —
// Next.js pages and route handlers, say — belong to a framework adapter, not
// here.
const TOOLING_ENTRY_POINTS: readonly RegExp[] = [
  /(^|\/)[^/]*\.config\.[cm]?[jt]sx?$/,
  /(^|\/)\.[^/]*rc(\.[cm]?[jt]sx?)?$/,
  /(^|\/)[^/]*\.setup\.[cm]?[jt]sx?$/,
];

// Assumes no framework at all: every source file in the tree is a node, and the
// only entry points it knows are the tooling config files above.
export const noFrameworkAdapter: FrameworkAdapter = Object.freeze({
  name: "none",
  entryPoints: TOOLING_ENTRY_POINTS,
});

const ADAPTERS: Record<string, FrameworkAdapter> = {
  [noFrameworkAdapter.name]: noFrameworkAdapter,
};

// The adapter a stored parse was produced with, looked up by the name it
// recorded. An unknown name falls back to the one that knows no framework, so
// reading an older parse never fails on a missing adapter.
export function adapterFor(name: string): FrameworkAdapter {
  return ADAPTERS[name] ?? noFrameworkAdapter;
}
