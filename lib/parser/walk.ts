import { promises as fs } from "node:fs";
import path from "node:path";
import { IGNORED_DIRECTORIES } from "./constants";
import { toPosix } from "./paths";

// A directory is ignored if it is hidden (".next", ".git", ".turbo", ...) or on
// the conventional generated-output list. Hiding the whole dot-directory class
// keeps generated output out without the parser naming any framework.
export function isIgnoredDirectoryName(
  name: string,
  extra: readonly string[] = [],
): boolean {
  if (name.startsWith(".")) return true;
  return IGNORED_DIRECTORIES.includes(name) || extra.includes(name);
}

export interface WalkedFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
}

export interface WalkResult {
  files: WalkedFile[];
  // Directories that were skipped whole, so the report can say what was not
  // entered rather than pretending those files do not exist.
  ignoredDirectories: string[];
}

export async function walkRepository(
  root: string,
  extraIgnored: readonly string[] = [],
): Promise<WalkResult> {
  const files: WalkedFile[] = [];
  const ignoredDirectories: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName(entry.name, extraIgnored)) {
          ignoredDirectories.push(toPosix(path.relative(root, absolutePath)));
          continue;
        }
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: toPosix(path.relative(root, absolutePath)),
          extension: path.extname(entry.name).toLowerCase(),
        });
      }
    }
  }

  await visit(root);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  ignoredDirectories.sort();
  return { files, ignoredDirectories };
}
