// The rail taxonomy: the roles a file can hold, what each one is called, the
// colour it is drawn with, and the order every framework presents them in.
//
// This file is deliberately free of any import from the parser, the filesystem
// or a framework package. A browser component reads the category names from
// here, and because nothing below it pulls in a parser, opening the page does
// not drag the parsing runtime into the bundle.
//
// A role is what a file is in *this* repository: a page route, a controller, or
// just "TypeScript" when nothing knew better. The adapters assign roles; this
// file names them, colours them and orders them. The two are kept apart so the
// naming survives without the thing that names.

// The generic role, read off the extension alone. It is the fallback for every
// file an adapter did not claim, so a repository that matches no framework
// still gets sensible categories instead of an empty rail.
export type FileKindRole = "ts" | "tsx" | "js" | "jsx" | "dts" | "other";

export function fileKindRole(path: string, extension: string): FileKindRole {
  if (extension === ".ts" && path.endsWith(".d.ts")) return "dts";
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") return "ts";
  if (extension === ".tsx") return "tsx";
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return "js";
  if (extension === ".jsx") return "jsx";
  return "other";
}

export interface RoleSpec {
  // The stored identifier. Stable: it is written to the database and read back,
  // so renaming one is a migration, not a relabel.
  role: string;
  // The label on the rail. A concrete role name — "Controllers", never
  // "Entry points" — because the reader wants to know what the files are.
  name: string;
  swatch: string;
}

// The generic roles as a rail, in reading order: typed languages first, then
// untyped, then everything the parser kept but could not place.
const GENERIC_ROLES: readonly RoleSpec[] = [
  { role: "ts", name: "TypeScript", swatch: "bg-file-ts" },
  { role: "tsx", name: "TSX", swatch: "bg-file-tsx" },
  { role: "js", name: "JavaScript", swatch: "bg-file-js" },
  { role: "jsx", name: "JSX", swatch: "bg-file-jsx" },
  { role: "dts", name: "Declarations", swatch: "bg-file-dts" },
  { role: "other", name: "Other", swatch: "bg-file-other" },
];

// The role for a file no framework pattern claimed in a repository a framework
// did claim. It exists so a recognized repository never falls back to the
// extension categories: a `.tsx` under a Next.js app that is not a page, a
// layout, or a component is honestly "unclassified", not "TypeScript React".
export const UNCLASSIFIED_ROLE = "unclassified";

// A framework's rail: every category the framework can produce, in fixed
// reading order, ending in Unclassified. It is never mixed with the generic
// extension categories — a detected framework replaces them, so a `.ts` service
// reads as a Service and a stray script reads as Unclassified, never as
// "TypeScript". The same repository always presents its categories in the same
// places.
const FRAMEWORK_ROLES: Record<string, readonly RoleSpec[]> = {
  nextjs: [
    { role: "page-route", name: "Page routes", swatch: "bg-file-tsx" },
    { role: "api-endpoint", name: "API endpoints", swatch: "bg-file-js" },
    { role: "server-action", name: "Server actions", swatch: "bg-file-ts" },
    { role: "layout", name: "Layouts", swatch: "bg-file-tsx" },
    { role: "loading-error", name: "Loading & error UI", swatch: "bg-file-tsx" },
    { role: "component", name: "Components", swatch: "bg-file-tsx" },
    { role: "hook", name: "Hooks", swatch: "bg-file-ts" },
    { role: "middleware", name: "Middleware", swatch: "bg-file-js" },
    { role: "metadata", name: "Metadata files", swatch: "bg-file-other" },
    { role: "instrumentation", name: "Instrumentation", swatch: "bg-file-other" },
    { role: "config", name: "Config files", swatch: "bg-file-dts" },
    { role: "test", name: "Tests", swatch: "bg-file-other" },
    { role: UNCLASSIFIED_ROLE, name: "Unclassified", swatch: "bg-file-other" },
  ],
  nestjs: [
    { role: "controller", name: "Controllers", swatch: "bg-file-ts" },
    { role: "service", name: "Services", swatch: "bg-file-ts" },
    { role: "module", name: "Modules", swatch: "bg-file-ts" },
    { role: "entity", name: "Entities", swatch: "bg-file-ts" },
    { role: UNCLASSIFIED_ROLE, name: "Unclassified", swatch: "bg-file-other" },
  ],
  react: [
    { role: "component", name: "Components", swatch: "bg-file-tsx" },
    { role: "hook", name: "Hooks", swatch: "bg-file-ts" },
    { role: UNCLASSIFIED_ROLE, name: "Unclassified", swatch: "bg-file-other" },
  ],
};

// The rail for one repository: the framework's categories when one was
// detected, the generic extension categories when none was. Never sorted by
// size — a category that moved when the counts changed would make the same
// repository read differently twice.
export function railFor(framework: string): readonly RoleSpec[] {
  return FRAMEWORK_ROLES[framework] ?? GENERIC_ROLES;
}

export function roleSpecFor(framework: string, role: string): RoleSpec | undefined {
  return railFor(framework).find((spec) => spec.role === role);
}

// Roles a framework reaches by convention rather than by an import, so a file
// holding one is not "a file nothing imports" — the framework is the importer.
// A Next.js page and a NestJS controller are loaded by the runtime, so holding
// one is enough to excuse a file from that verdict.
const ENTRY_ROLES: ReadonlySet<string> = new Set([
  "page-route",
  "api-endpoint",
  "layout",
  "loading-error",
  "middleware",
  "metadata",
  "instrumentation",
  "config",
  "test",
  "controller",
]);

export function isEntryRole(role: string | undefined): boolean {
  return role !== undefined && ENTRY_ROLES.has(role);
}

// Tooling config, reached by whatever reads it rather than by an import. The
// same in every repository, so it is not framework knowledge and it lives here
// rather than in an adapter.
export const CONFIG_FILE = /(^|\/)[^/]*\.config\.[cm]?[jt]s$/;

const FRAMEWORK_LABEL: Record<string, string> = {
  none: "None detected",
  nextjs: "Next.js",
  nestjs: "NestJS",
  react: "React",
};

export function frameworkLabel(framework: string): string {
  return FRAMEWORK_LABEL[framework] ?? framework;
}
