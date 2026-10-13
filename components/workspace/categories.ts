// A file category is what a file is (a kind), derived from the extension the
// parser recorded. It is derived here, never stored: the parser's shape is the
// contract, and anything the canvas needs on top of it is computed at render.

export type FileKind = "ts" | "tsx" | "js" | "jsx" | "dts" | "other";

interface CategorySpec {
  name: string;
  swatch: string;
}

const SPEC: Record<FileKind, CategorySpec> = {
  ts: { name: "TypeScript", swatch: "bg-file-ts" },
  tsx: { name: "TSX", swatch: "bg-file-tsx" },
  js: { name: "JavaScript", swatch: "bg-file-js" },
  jsx: { name: "JSX", swatch: "bg-file-jsx" },
  dts: { name: "Declarations", swatch: "bg-file-dts" },
  other: { name: "Other", swatch: "bg-file-other" },
};

const ORDER: readonly FileKind[] = ["ts", "tsx", "js", "jsx", "dts", "other"];

export interface FileCategory {
  kind: FileKind;
  name: string;
  swatch: string;
  count: number;
}

export interface FileLike {
  path: string;
  extension: string;
}

export function fileKind(file: FileLike): FileKind {
  const { path, extension } = file;
  if (extension === ".ts" && path.endsWith(".d.ts")) return "dts";
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") {
    return "ts";
  }
  if (extension === ".tsx") return "tsx";
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return "js";
  }
  if (extension === ".jsx") return "jsx";
  return "other";
}

export function countCategories(files: readonly FileLike[]): FileCategory[] {
  const counts = new Map<FileKind, number>();
  for (const file of files) {
    const kind = fileKind(file);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return ORDER.filter((kind) => (counts.get(kind) ?? 0) > 0)
    .map((kind) => ({
      kind,
      name: SPEC[kind].name,
      swatch: SPEC[kind].swatch,
      count: counts.get(kind) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}