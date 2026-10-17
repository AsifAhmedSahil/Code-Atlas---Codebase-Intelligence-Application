// Explaining one thing on the map, and caching the answer.
//
// Everything the model may see is assembled here from this repository's own
// parse result: a file's contents and its real neighbours, or a folder's files
// and the real edges crossing its boundary. The model is handed paths; it never
// discovers one.
//
// The cache is the other half of this module, and it is deliberately inside the
// traced call. A second request for the same content is a recorded run with no
// child model call — which is the only way to tell a working cache from a broken
// one when reading the traces. The key is the content, the pinned model and the
// prompt version, so a changed file misses and a re-pinned model starts fresh.
//
// A page load is a third kind of request: it wants only what is already stored,
// never a generation. That is `restoreCachedExplanation` — same key, same read,
// no model — because an answer that exists only in the browser is not an answer
// the reader can keep.

import type { SupabaseClient } from "@supabase/supabase-js";
import { traceable } from "langsmith/traceable";

import type { FoldedMap } from "@/lib/map/fold";
import type { ParseResult } from "@/lib/parser/types";
import { UNCLASSIFIED_ROLE } from "@/lib/roles/taxonomy";
import { fetchRawFile, parseRepoUrl, type RepoRef } from "@/lib/pipeline/github";
import type { Database } from "@/lib/supabase/database.types";

import { folderContentHash, type ExplanationKey } from "./cache";
import {
  fileHash,
  fileNeighbourhood,
  folderContext,
  folderFiles,
  roleByPath,
} from "./context";
import { aiClient, aiConfigured, MODEL, PROMPT_VERSION, tracingEnabled } from "./model";
import { buildFilePrompt, buildFolderPrompt, type Prompt } from "./prompt";
import { checkStaleness } from "./staleness";
import type { ExplanationResult, Staleness, SubjectKind } from "./subject";

// Raised when the cache missed and no key is configured, so the caller can say
// "configure a key" rather than "the model failed".
class UnconfiguredError extends Error {}

export interface ExplanationSource {
  analysisId: string;
  organizationId: string;
  repoUrl: string;
  commitSha: string | null;
  result: ParseResult;
  map: FoldedMap;
}

async function readCached(
  client: SupabaseClient<Database>,
  key: ExplanationKey,
): Promise<string | null> {
  const { data, error } = await client
    .from("explanations")
    .select("body")
    .eq("analysis_id", key.analysisId)
    .eq("subject_kind", key.subjectKind)
    .eq("subject_id", key.subjectId)
    .eq("model", key.model)
    .eq("prompt_version", key.promptVersion)
    .eq("content_hash", key.contentHash)
    .maybeSingle();
  if (error) throw new Error(`Could not read the explanation cache: ${error.message}`);
  return data?.body ?? null;
}

async function writeCached(
  client: SupabaseClient<Database>,
  key: ExplanationKey,
  organizationId: string,
  body: string,
): Promise<void> {
  const { error } = await client.from("explanations").insert({
    organization_id: organizationId,
    analysis_id: key.analysisId,
    subject_kind: key.subjectKind,
    subject_id: key.subjectId,
    content_hash: key.contentHash,
    model: key.model,
    prompt_version: key.promptVersion,
    body,
  });
  // The unique index over the key means a concurrent writer can land the same
  // row first. That is a cache hit arriving late, not an error.
  if (error && error.code !== "23505") {
    throw new Error(`Could not write the explanation cache: ${error.message}`);
  }
}

async function ask(prompt: Prompt): Promise<string> {
  const completion = await aiClient().chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    max_tokens: 400,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });
  const body = completion.choices[0]?.message?.content?.trim() ?? "";
  if (body.length === 0) throw new Error("The model returned an empty explanation.");
  return body;
}

async function generate(
  source: ExplanationSource,
  subjectKind: SubjectKind,
  subjectId: string,
): Promise<string> {
  const roles = roleByPath(source.result);

  if (subjectKind === "folder") {
    const context = folderContext(source.result, source.map, subjectId, roles);
    if (!context) throw new Error("That folder is not on this map.");
    return ask(
      buildFolderPrompt({
        folder: context.folder,
        adapter: source.result.adapter,
        files: context.files,
        importedFromOutside: context.importedFromOutside,
        importsOutside: context.importsOutside,
        internalEdges: context.internalEdges,
      }),
    );
  }

  // A file is explained from the exact revision that was analysed, so the
  // contents the model reads are the contents the neighbours were computed from.
  if (!source.commitSha) {
    throw new Error(
      "This analysis did not record a commit, so its files cannot be read back. Re-analyse to explain files.",
    );
  }
  const ref = parseRepoUrl(source.repoUrl);
  const contents = await fetchRawFile(ref, source.commitSha, subjectId);
  const neighbourhood = fileNeighbourhood(source.result, subjectId, roles);
  return ask(
    buildFilePrompt({
      path: subjectId,
      role: roles.get(subjectId) ?? UNCLASSIFIED_ROLE,
      adapter: source.result.adapter,
      contents,
      dependencies: neighbourhood.dependencies,
      dependents: neighbourhood.dependents,
    }),
  );
}

// The key this subject's answer is cached under, or null when the subject is not
// one this map can explain (a file with no stored content, a folder not present).
function keyFor(
  source: ExplanationSource,
  subjectKind: SubjectKind,
  subjectId: string,
): ExplanationKey | null {
  if (subjectKind === "folder") {
    const files = folderFiles(source.result, source.map, subjectId);
    if (files.length === 0 && !source.map.nodes.some((node) => node.id === subjectId)) {
      return null;
    }
    return {
      analysisId: source.analysisId,
      subjectKind,
      subjectId,
      model: MODEL,
      promptVersion: PROMPT_VERSION.folder,
      contentHash: folderContentHash(files),
    };
  }
  const hash = fileHash(source.result, subjectId);
  if (hash === undefined) return null;
  return {
    analysisId: source.analysisId,
    subjectKind,
    subjectId,
    model: MODEL,
    promptVersion: PROMPT_VERSION.file,
    contentHash: hash,
  };
}

// Every result describes its subject the same way, so the shape is built once.
type ResultBase = Omit<ExplanationResult, "status" | "body" | "cached">;

function resultBase(subjectKind: SubjectKind, subjectId: string): ResultBase {
  return {
    subjectKind,
    subjectId,
    model: MODEL,
    tracing: tracingEnabled(),
    staleness: { moved: false } as Staleness,
  };
}

export async function explainSubject(
  client: SupabaseClient<Database>,
  source: ExplanationSource,
  subjectKind: SubjectKind,
  subjectId: string,
): Promise<ExplanationResult> {
  const base = resultBase(subjectKind, subjectId);

  const key = keyFor(source, subjectKind, subjectId);
  if (!key) {
    return {
      ...base,
      status: "error",
      body: "",
      cached: false,
      message:
        subjectKind === "folder"
          ? "That folder is not on this map."
          : "That file was not part of the analysed source.",
    };
  }

  // The whole operation, cache read included, is one traced run. The model call
  // inside it, when there is one, is a child run; a cache hit is this run alone.
  const run = traceable(
    async (): Promise<{ body: string; cached: boolean }> => {
      const cached = await readCached(client, key);
      if (cached !== null) return { body: cached, cached: true };
      if (!aiConfigured()) throw new UnconfiguredError();
      const body = await generate(source, subjectKind, subjectId);
      await writeCached(client, key, source.organizationId, body);
      return { body, cached: false };
    },
    {
      name: `explain ${subjectKind}`,
      run_type: "chain",
      metadata: {
        analysisId: source.analysisId,
        subjectKind,
        subjectId,
        model: MODEL,
        promptVersion: key.promptVersion,
        contentHash: key.contentHash,
      },
    },
  );

  let outcome: { body: string; cached: boolean };
  try {
    outcome = await run();
  } catch (error) {
    if (error instanceof UnconfiguredError) {
      return {
        ...base,
        status: "unconfigured",
        body: "",
        cached: false,
        message:
          "No OPENAI_API_KEY is configured, so nothing can be explained yet.",
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, status: "error", body: "", cached: false, message };
  }

  // Staleness is checked after the answer exists, best effort, and never fails
  // the explanation: it is a note beside the answer, not a part of it.
  let staleness: Staleness = { moved: false };
  if (source.commitSha) {
    try {
      const ref: RepoRef = parseRepoUrl(source.repoUrl);
      staleness = await checkStaleness({
        ref,
        analyzedSha: source.commitSha,
        path: subjectKind === "file" ? subjectId : undefined,
        storedHash: subjectKind === "file" ? key.contentHash : undefined,
      });
    } catch {
      staleness = { moved: false };
    }
  }

  return { ...base, status: "ok", body: outcome.body, cached: outcome.cached, staleness };
}

// What a page load asks for: the stored answer for this exact key, or nothing.
//
// `null` means nothing is cached for the key — a genuine miss, so the caller
// shows the button and the reader decides whether to spend a model call. An
// error result is returned rather than thrown for every failure the reader can
// act on: an unexplainable subject, or a cache that could not be read. Neither
// is a reason to silently generate.
//
// Deliberately a pure read. Staleness costs two GitHub calls and is a courtesy
// the reader asked for when they pressed Explain; it must not run on every
// selection change, so a restored answer reports no staleness.
export async function restoreCachedExplanation(
  client: SupabaseClient<Database>,
  source: ExplanationSource,
  subjectKind: SubjectKind,
  subjectId: string,
): Promise<ExplanationResult | null> {
  const base = resultBase(subjectKind, subjectId);

  const key = keyFor(source, subjectKind, subjectId);
  if (!key) {
    return {
      ...base,
      status: "error",
      body: "",
      cached: false,
      message:
        subjectKind === "folder"
          ? "That folder is not on this map."
          : "That file was not part of the analysed source.",
    };
  }

  // Traced like any other access to the cache, so a restored answer appears in
  // LangSmith as a run with no child — the same shape as a clicked cache hit.
  const run = traceable(
    async (): Promise<string | null> => readCached(client, key),
    {
      name: `restore ${subjectKind}`,
      run_type: "chain",
      metadata: {
        analysisId: source.analysisId,
        subjectKind,
        subjectId,
        model: MODEL,
        promptVersion: key.promptVersion,
        contentHash: key.contentHash,
      },
    },
  );

  try {
    const body = await run();
    if (body === null) return null;
    return { ...base, status: "ok", body, cached: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, status: "error", body: "", cached: false, message };
  }
}
