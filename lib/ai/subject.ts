// The vocabulary the explanation feature shares between the server and the
// browser. Kept free of any import so a client component can name a result
// without dragging the model client, the database or node:crypto into the
// bundle.

export type SubjectKind = "file" | "folder";

export interface Staleness {
  // The repository's default branch points at a commit newer than the analysed
  // one.
  moved: boolean;
  // The file's content at the branch head differs from the content analysed.
  // Absent when the file's own content was not checked.
  fileChanged?: boolean;
}

export type ExplainStatus = "ok" | "unconfigured" | "error";

export interface ExplanationResult {
  status: ExplainStatus;
  subjectKind: SubjectKind;
  subjectId: string;
  body: string;
  // The answer came from the cache; no model call was made for it this time.
  cached: boolean;
  model: string;
  // Whether the call was recorded. An absent tracing key looks exactly like a
  // working setup that has seen no traffic, so it is said out loud.
  tracing: boolean;
  staleness: Staleness;
  message?: string;
}

// The key an answer is remembered under in the browser, so moving the selection
// away and back shows the same explanation without asking again. It is the same
// tuple the server caches on, minus the content hash, which the browser has no
// way to have changed on its own.
export function explanationKey(
  analysisId: string,
  subjectKind: SubjectKind,
  subjectId: string,
): string {
  return `${analysisId}\u0000${subjectKind}\u0000${subjectId}`;
}
