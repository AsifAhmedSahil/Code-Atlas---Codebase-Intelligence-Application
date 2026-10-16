// The interface a framework adapter implements, and the shapes the parser hands
// it. The parser itself never tests for a framework: it detects one, asks it for
// roles and routes, and moves on. Everything framework-specific lives under
// `adapters/`.

export interface AdapterFile {
  // Repository-relative, forward slashes.
  path: string;
  extension: string;
  content: string;
}

export interface AdapterContext {
  files: readonly AdapterFile[];
  // Package names from the repository's package.json (all dependency groups).
  packages: ReadonlySet<string>;
}

// A route recovered from the syntax, exact or absent. `method` is null for a
// page, which has no HTTP verb to recover.
export interface AdapterRoute {
  kind: "page" | "api";
  method: string | null;
  path: string;
  file: string;
}

export interface FrameworkAdapter {
  readonly name: string;
  // Is this framework the one that describes the repository? The registry tries
  // adapters in a fixed order and the first match wins.
  detect(context: AdapterContext): boolean;
  // The role this file plays, or null when the adapter has nothing to say and
  // the generic extension role should stand.
  role(file: AdapterFile): string | null;
  // Exact routes only. A route whose method or full pattern cannot be read from
  // the syntax is left out rather than guessed.
  routes(context: AdapterContext): AdapterRoute[];
}
