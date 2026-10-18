// The retired explanation prompt, kept only for the comparison.
//
// Phase 11 runs the current prompt against a previous one over the same files
// and scores both, so the value of the change is a number rather than an
// opinion. There was no version of this prompt saved anywhere before, so this is
// the earlier design reconstructed: it shows the model the file's contents and
// its role, and nothing else. It does not list the file's real neighbours, and
// it does not forbid naming files it was not given. Those are precisely the two
// things the current prompt adds, so the comparison measures them.
//
// This lives in the evals on purpose. The application never imports it: it is
// the "before", not a fallback.

import { CONTENT_LIMIT } from "../../lib/ai/prompt";
import type { FilePromptInput, Prompt } from "../../lib/ai/prompt";

export const FILE_V0_VERSION = "file/v0";

const FILE_V0_SYSTEM = [
  "You explain a single file from a software repository to a reader who has",
  "selected it on a map of that repository. You are given the file's contents.",
  "",
  "Write two short paragraphs: what the file does, and anything else about it a",
  "reader might find useful.",
].join("\n");

function clip(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

export function buildFileV0Prompt(input: FilePromptInput): Prompt {
  const content = clip(input.contents, CONTENT_LIMIT);
  const user = [
    `Repository framework: ${input.adapter}`,
    "",
    `File: ${input.path}`,
    `Its role here: ${input.role}`,
    "",
    "--- file contents ---",
    `${content.text}${content.truncated ? "\n... (contents truncated)" : ""}`,
    "--- end file contents ---",
  ].join("\n");
  return { system: FILE_V0_SYSTEM, user };
}
