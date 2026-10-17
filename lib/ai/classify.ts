// Assigning roles to the files no adapter could identify.
//
// This runs as its own pipeline stage, after parsing and before storing, and it
// is the one place a run makes model calls on its own behalf. It is deliberately
// timid: it only ever looks at files an adapter left "unclassified", it asks for
// one non-structural word per file, it never overrides a role a rule gave, and
// any failure — no key, a timeout, a reply that is not one of the allowed words
// — leaves the file exactly as it was. A run is never failed by classification.

import { open } from "node:fs/promises";
import path from "node:path";

import type { ParseResult } from "../parser/types";
import { UNCLASSIFIED_ROLE } from "../roles/taxonomy";
import { aiClient, aiConfigured, MODEL } from "./model";
import { buildClassifyPrompt, normalizeClassification } from "./prompt";

// How many files are ever sent, and how many at once. A run that got a hundred
// unclassified files would otherwise spend a long time and a lot of tokens on
// the least valuable part of the map; the first forty, in path order, is a
// bound the reader pays for once and can see.
const CLASSIFY_LIMIT = 40;
const CONCURRENCY = 4;
const EXCERPT_BYTES = 2000;

async function excerptOf(absolutePath: string): Promise<string | null> {
  try {
    const handle = await open(absolutePath, "r");
    try {
      const buffer = Buffer.alloc(EXCERPT_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, EXCERPT_BYTES, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

// One file, one word. A reply that is not exactly one allowed role — an empty
// string, a sentence, a structural word — returns null and the file keeps its
// unclassified role.
async function classifyOne(
  root: string,
  filePath: string,
  adapter: string,
): Promise<{ path: string; role: string } | null> {
  const excerpt = await excerptOf(path.join(root, filePath));
  if (excerpt === null) return null;
  const extension = path.extname(filePath);
  const prompt = buildClassifyPrompt({ path: filePath, extension, adapter, excerpt });

  const completion = await aiClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: 4,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });
  const answer = completion.choices[0]?.message?.content ?? "";
  const role = normalizeClassification(answer);
  // "unclassified" is the model declining, which is the state the file is
  // already in. Only a changed answer is an assignment.
  if (role === null || role === UNCLASSIFIED_ROLE) return null;
  return { path: filePath, role };
}

export interface ClassifyInput {
  // The extracted repository on disk, still present while the run is alive, so
  // the beginning of a file can be read without having kept every file in memory.
  root: string;
  result: ParseResult;
}

export async function classifyUnidentified(input: ClassifyInput): Promise<ParseResult> {
  const { root, result } = input;
  if (!aiConfigured()) return result;

  const targets = result.roles
    .filter((entry) => entry.role === UNCLASSIFIED_ROLE)
    .map((entry) => entry.path)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, CLASSIFY_LIMIT);
  if (targets.length === 0) return result;

  const assignments = new Map<string, string>();
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= targets.length) return;
      try {
        const classified = await classifyOne(root, targets[index], result.adapter);
        if (classified) assignments.set(classified.path, classified.role);
      } catch {
        // Best effort: a file the model could not be asked about stays as it is.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
  );
  if (assignments.size === 0) return result;

  const roles = result.roles.map((entry) => {
    const role = assignments.get(entry.path);
    // An assigned role is marked as the model's, so it never reads as a rule's.
    return role === undefined ? entry : { path: entry.path, role, source: "ai" as const };
  });
  return { ...result, roles };
}
