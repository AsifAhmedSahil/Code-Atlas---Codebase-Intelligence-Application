// File selection is structural, never "the biggest N files": a file selection
// that keeps a module but drops the leaf it imports produces edges pointing at
// nodes that do not exist, and it never shows on a small demo repository.

// Only these become nodes. Everything else is still counted, and reported with
// a reason, but is not parsed.
export const MODULE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

// Directories that are generated output or third-party code by convention, not
// source. Any hidden directory (".next", ".git", ".turbo", ...) is ignored on
// top of this list, which is why no framework has to be named here.
export const IGNORED_DIRECTORIES: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "tmp",
];
