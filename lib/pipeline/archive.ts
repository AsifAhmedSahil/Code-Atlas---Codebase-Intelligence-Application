// Unpacking a downloaded repository archive.
//
// The archive is a gzipped tar with a single top-level directory named
// `<repo>-<short-sha>/`. Extraction shells out to the platform's `tar`, which is
// present on the machines this runs on and saves pulling in a dependency for a
// format the operating system already reads.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function extractArchive(
  archivePath: string,
  intoDirectory: string,
): Promise<void> {
  await fs.mkdir(intoDirectory, { recursive: true });
  try {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", intoDirectory]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not unpack the repository archive: ${detail}`);
  }
}

// GitHub wraps everything in one directory; parse from inside it so paths are
// repository-relative rather than `<repo>-<sha>/...`. If there is no single
// wrapper, the extraction directory is the repository.
export async function repositoryRoot(extractionDirectory: string): Promise<string> {
  const entries = await fs.readdir(extractionDirectory, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (entries.length === 1 && directories.length === 1) {
    return path.join(extractionDirectory, directories[0].name);
  }
  return extractionDirectory;
}
