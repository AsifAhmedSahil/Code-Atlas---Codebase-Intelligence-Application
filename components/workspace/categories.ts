// A file category is what a file is: the role the parser assigned to it, or the
// generic extension role when no adapter claimed it. The names and the order
// come from the taxonomy, so the rail a browser shows uses the same words the
// parser wrote without importing the parser (or a framework) into the bundle.

import {
  fileKindRole,
  railFor,
  roleSpecFor,
  type FileKindRole,
  type RoleSpec,
} from "@/lib/roles/taxonomy";

export type FileKind = FileKindRole;

export interface FileLike {
  path: string;
  extension: string;
}

// The role read off the extension alone. The adapters assign the framework
// roles; this is the floor under them.
export function fileKind(file: FileLike): FileKind {
  return fileKindRole(file.path, file.extension);
}

export function kindLabel(kind: FileKind): string {
  return roleSpecFor("none", kind)?.name ?? kind;
}

// The name to show for a role, in the words the detected framework uses. Falls
// back to the raw id so a role written by a newer adapter is shown, not hidden.
export function roleLabel(framework: string, role: string): string {
  return roleSpecFor(framework, role)?.name ?? role;
}

export interface FileCategory {
  // The role id, which is also the value the rail filters on.
  role: string;
  name: string;
  swatch: string;
  count: number;
}

// The rail for one repository: the roles present among its files, in the
// taxonomy's fixed reading order. Never sorted by size — a category that moved
// when the counts changed would make the same repository read differently twice.
export function countCategories(
  files: readonly FileLike[],
  roleByPath: ReadonlyMap<string, string>,
  framework: string,
): FileCategory[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const role = roleByPath.get(file.path) ?? fileKind(file);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }

  const known: readonly RoleSpec[] = railFor(framework);
  const present = known.filter((spec) => (counts.get(spec.role) ?? 0) > 0);
  const categories = present.map((spec) => ({
    role: spec.role,
    name: spec.name,
    swatch: spec.swatch,
    count: counts.get(spec.role) ?? 0,
  }));

  // A role the taxonomy does not name — a newer adapter read by an older build
  // — is still shown, under its own id, rather than silently hidden.
  for (const [role, count] of counts) {
    if (known.some((spec) => spec.role === role)) continue;
    categories.push({ role, name: role, swatch: "bg-file-other", count });
  }

  return categories;
}
