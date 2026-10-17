// The key an explanation is cached under.
//
// A cached answer is only reused when everything that could change the answer is
// the same: the analysis, what the subject is, which model wrote it, which
// version of the prompt asked, and a hash of the content itself. The database
// holds a unique index over exactly this tuple, so a repeated request reads the
// row rather than the repository, and a changed file misses and is asked again.

import { createHash } from "node:crypto";

import type { SubjectKind } from "./subject";

export interface ExplanationKey {
  analysisId: string;
  subjectKind: SubjectKind;
  // The file path for a file, the folder (map node) id for a folder.
  subjectId: string;
  model: string;
  promptVersion: string;
  contentHash: string;
}

// A folder's content hash is the hash of its files' hashes, path-tagged and
// ordered, so a folder's key moves when any file in it changes and does not move
// when the files are merely listed in a different order.
export function folderContentHash(
  files: readonly { path: string; hash: string }[],
): string {
  const sorted = [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const digest = createHash("sha256");
  for (const file of sorted) {
    digest.update(file.path, "utf8");
    digest.update("\n", "utf8");
    digest.update(file.hash, "utf8");
    digest.update("\n", "utf8");
  }
  return digest.digest("hex");
}
