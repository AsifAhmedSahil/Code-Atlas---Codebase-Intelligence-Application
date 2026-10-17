// The words sent to the model, and nothing else. Pure string building, so the
// exact prompt can be asserted in a test without a model, a database or a
// network. The model is handed a fixed set of paths and told that is all it has.

export interface Prompt {
  system: string;
  user: string;
}

export interface PromptNeighbour {
  path: string;
  role: string;
}

// How many neighbours are ever listed. A file with hundreds of importers would
// otherwise carry a prompt the model cannot use; the short count says how many
// were left out, and no path that is left out is ever mentioned.
const NEIGHBOUR_LIMIT = 40;

// How much of a file is sent. Enough to see what it is, bounded so the call
// stays a fixed size whatever the repository holds.
const CONTENT_LIMIT = 6000;

// The three pieces of formatting the pane renders, and the prohibition on the
// rest. The pane is narrow: headings would cut a few short paragraphs into
// labelled fragments, which is why they are refused rather than rendered.
const FORMAT_RULES = [
  "Formatting, and nothing else:",
  '- plain sentences;',
  '- a line beginning "- " for a bullet;',
  "- inline code in backticks for an identifier or a file path;",
  "- **bold** around the name of a file you are naming.",
  "No headings, no tables, no links, no numbered lists, no nested bullets.",
].join("\n");

const FILE_SYSTEM = [
  "You explain a single file from a software repository to a reader who has",
  "selected it on a map of that repository. You are given the file's contents",
  "and the real lists of the files it imports and the files that import it. Use",
  "only what you are given.",
  "",
  "Write at most two short paragraphs. Say what the file does and what it is for",
  "here, naming a neighbour by path only when that reveals how the file works.",
  "Name a file only if it appears in the lists below. Never claim that a file",
  "which is not listed is connected to this one, and never describe the whole",
  "repository.",
  "",
  FORMAT_RULES,
].join("\n");

const FOLDER_SYSTEM = [
  "You explain one folder of a software repository to a reader who has selected",
  "it on a map of that repository. You are given the folder's files and the",
  "files elsewhere that import into it and that its files import. Use only what",
  "you are given.",
  "",
  "Write at most two short paragraphs about this part of the repository: what it",
  "is and what it is responsible for. Do not summarise one file in it, and do",
  "not walk through the files one by one unless that is the only way to say what",
  "the folder is. Name a file only if it appears in the list below. Never claim",
  "that two files are connected unless the lists say so, and never describe the",
  "whole repository.",
  "",
  FORMAT_RULES,
].join("\n");

const CLASSIFY_SYSTEM = [
  "You decide what a single file is in a software repository, from its path, its",
  "extension and the beginning of its contents. Answer with exactly one word.",
  "",
  "Choose from: service, repository, model, util, config, component, hook.",
  "If none of those fits, answer: unclassified.",
  "",
  "Never answer page, route, controller, layout, middleware, or any other word",
  "that names a place the framework routes to or loads by convention. Those are",
  "not yours to decide.",
].join("\n");

function clip(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

function listNeighbours(label: string, files: readonly PromptNeighbour[]): string {
  if (files.length === 0) return `${label}: none.`;
  const shown = files.slice(0, NEIGHBOUR_LIMIT);
  const lines = shown.map((file) => `- ${file.path} (${file.role})`);
  const hidden = files.length - shown.length;
  if (hidden > 0) {
    lines.push(`(${hidden} more not listed)`);
  }
  return `${label}:\n${lines.join("\n")}`;
}

export interface FilePromptInput {
  path: string;
  role: string;
  adapter: string;
  contents: string;
  dependencies: readonly PromptNeighbour[];
  dependents: readonly PromptNeighbour[];
}

export function buildFilePrompt(input: FilePromptInput): Prompt {
  const content = clip(input.contents, CONTENT_LIMIT);
  const user = [
    `Repository framework: ${input.adapter}`,
    "",
    `File: ${input.path}`,
    `Its role here: ${input.role}`,
    "",
    listNeighbours("This file imports", input.dependencies),
    "",
    listNeighbours("This file is imported by", input.dependents),
    "",
    "--- file contents ---",
    `${content.text}${content.truncated ? "\n... (contents truncated)" : ""}`,
    "--- end file contents ---",
  ].join("\n");
  return { system: FILE_SYSTEM, user };
}

export interface FolderFile {
  path: string;
  role: string;
}

export interface FolderPromptInput {
  folder: string;
  adapter: string;
  files: readonly FolderFile[];
  // Files elsewhere in the repository that import into this folder.
  importedFromOutside: readonly string[];
  // Files elsewhere that this folder's files import.
  importsOutside: readonly string[];
  // Edges between two files that both live in this folder.
  internalEdges: number;
}

const FILE_LIST_LIMIT = 60;

export function buildFolderPrompt(input: FolderPromptInput): Prompt {
  const shown = input.files.slice(0, FILE_LIST_LIMIT);
  const hidden = input.files.length - shown.length;
  const fileLines = shown.map((file) => `- ${file.path} (${file.role})`);
  if (hidden > 0) fileLines.push(`(${hidden} more not listed)`);

  const fromOutside = input.importedFromOutside.slice(0, NEIGHBOUR_LIMIT);
  const toOutside = input.importsOutside.slice(0, NEIGHBOUR_LIMIT);
  const outsideLines =
    fromOutside.length > 0
      ? fromOutside.map((path) => `- ${path}`).join("\n")
      : "- (none)";
  const toLines =
    toOutside.length > 0 ? toOutside.map((path) => `- ${path}`).join("\n") : "- (none)";

  const user = [
    `Repository framework: ${input.adapter}`,
    "",
    `Folder: ${input.folder}${input.folder === "." ? " (the repository root)" : ""}`,
    "",
    `Files in this folder (${input.files.length}):`,
    fileLines.length > 0 ? fileLines.join("\n") : "- (none)",
    "",
    `${input.importedFromOutside.length} file(s) elsewhere import into this folder:`,
    outsideLines,
    "",
    `Files in this folder import ${input.importsOutside.length} file(s) elsewhere:`,
    toLines,
    "",
    `Connections between two files inside this folder: ${input.internalEdges}.`,
  ].join("\n");

  return { system: FOLDER_SYSTEM, user };
}

export interface ClassifyPromptInput {
  path: string;
  extension: string;
  adapter: string;
  excerpt: string;
}

const EXCERPT_LIMIT = 1500;

export function buildClassifyPrompt(input: ClassifyPromptInput): Prompt {
  const excerpt = clip(input.excerpt, EXCERPT_LIMIT);
  const user = [
    `Repository framework: ${input.adapter}`,
    `File: ${input.path}`,
    `Extension: ${input.extension || "(none)"}`,
    "",
    "--- beginning of the file ---",
    `${excerpt.text}${excerpt.truncated ? "\n... (truncated)" : ""}`,
    "--- end of the file ---",
  ].join("\n");
  return { system: CLASSIFY_SYSTEM, user };
}

// The roles classification is allowed to produce. All are non-structural: none
// of them decides the route table or the entry-point colouring, which stay the
// framework conventions' to give.
export const CLASSIFIABLE_ROLES = [
  "service",
  "repository",
  "model",
  "util",
  "config",
  "component",
  "hook",
  "unclassified",
] as const;

export type ClassifiableRole = (typeof CLASSIFIABLE_ROLES)[number];

// Roles a framework reaches by convention. Classification may never return one,
// so this is stated as an explicit set an assertion can check against rather
// than left implicit in a prompt sentence.
export const STRUCTURAL_ROLES: ReadonlySet<string> = new Set([
  "page",
  "page-route",
  "api-endpoint",
  "route",
  "controller",
  "layout",
  "loading-error",
  "server-action",
  "middleware",
  "metadata",
  "instrumentation",
  "module",
  "entity",
  "test",
]);

// The model's answer, reduced to a role it is allowed to have meant, or null if
// it answered anything else. Structural words normalise to null, so a model
// that ignores its instructions cannot hand back a route.
export function normalizeClassification(answer: string): ClassifiableRole | null {
  const word = answer.trim().toLowerCase().replace(/[^a-z]/g, "");
  return (CLASSIFIABLE_ROLES as readonly string[]).includes(word)
    ? (word as ClassifiableRole)
    : null;
}
