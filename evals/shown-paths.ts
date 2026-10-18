// The exact set of paths a prompt showed the model.
//
// The invented-path check needs to know which file paths an answer was allowed
// to name. Rather than parse the prompt back out of its own text, this
// recomputes the set from the same parse result and the same limits the prompt
// builder uses: the subject, plus the neighbours the builder lists. A separate
// check (scripts/check-phase11.ts) rebuilds the real prompt text and asserts
// the two agree, so this stays faithful if the prompt builder changes.

import { fileNeighbourhood, folderContext, roleByPath } from "../lib/ai/context";
import { FILE_LIST_LIMIT, NEIGHBOUR_LIMIT } from "../lib/ai/prompt";
import type { SubjectKind } from "../lib/ai/subject";
import type { FoldedMap } from "../lib/map/fold";
import type { ParseResult } from "../lib/parser/types";

// The paths a `file` or `folder` prompt lists for the model to name. Empty if
// the subject is not in the parse result (a subject that no longer exists shows
// nothing, so an answer about it can name nothing without inventing).
export function shownPaths(
  result: ParseResult,
  map: FoldedMap,
  kind: SubjectKind,
  subjectId: string,
): Set<string> {
  const roles = roleByPath(result);
  const shown = new Set<string>();

  if (kind === "file") {
    const known = result.files.some((file) => file.path === subjectId);
    if (!known) return shown;
    shown.add(subjectId);
    const neighbourhood = fileNeighbourhood(result, subjectId, roles);
    for (const file of neighbourhood.dependencies.slice(0, NEIGHBOUR_LIMIT)) {
      shown.add(file.path);
    }
    for (const file of neighbourhood.dependents.slice(0, NEIGHBOUR_LIMIT)) {
      shown.add(file.path);
    }
    return shown;
  }

  const context = folderContext(result, map, subjectId, roles);
  if (context === null) return shown;
  shown.add(context.folder);
  for (const file of context.files.slice(0, FILE_LIST_LIMIT)) {
    shown.add(file.path);
  }
  for (const path of context.importedFromOutside.slice(0, NEIGHBOUR_LIMIT)) {
    shown.add(path);
  }
  for (const path of context.importsOutside.slice(0, NEIGHBOUR_LIMIT)) {
    shown.add(path);
  }
  return shown;
}
