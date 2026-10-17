// Whether the repository has moved on from the commit an analysis was taken at.
//
// An explanation is true of the content it was written from. When the default
// branch has since moved past that commit the reader should be told, and when
// the explained file itself has changed they should be told that too. This is a
// courtesy, not a correctness gate: a failure to reach GitHub resolves to "not
// moved", because the explanation is still valid for the commit it was written
// at and a network error must never be drawn as a change.

import { createHash } from "node:crypto";

import { fetchHeadSha, fetchRawFile, type RepoRef } from "../pipeline/github";
import type { Staleness } from "./subject";

export async function checkStaleness(args: {
  ref: RepoRef;
  analyzedSha: string;
  // Only a file can be checked against its own content; a folder is checked for
  // movement only, since a changed file in it is not a different question.
  path?: string;
  storedHash?: string;
}): Promise<Staleness> {
  try {
    const headSha = await fetchHeadSha(args.ref);
    if (headSha === args.analyzedSha) return { moved: false };
    if (args.path !== undefined && args.storedHash !== undefined) {
      const head = await fetchRawFile(args.ref, headSha, args.path);
      const headHash = createHash("sha256").update(head, "utf8").digest("hex");
      return { moved: true, fileChanged: headHash !== args.storedHash };
    }
    return { moved: true };
  } catch {
    return { moved: false };
  }
}
