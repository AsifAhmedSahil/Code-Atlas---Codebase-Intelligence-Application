// The one place an AI client exists.
//
// Every model call in the application goes through `aiClient`, and the client it
// returns is wrapped for tracing, so a call is traced whether or not the caller
// thought about tracing. The API key is read here and nowhere else; a component
// never sees it, and neither does any other server module.

import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers/openai";

// Pinned exactly, never a moving alias. The name is part of every explanation's
// cache key, so re-pinning this invalidates only the rows this model wrote and
// leaves every other model's rows untouched.
export const MODEL = "gpt-4o-mini";

// Bumped when the words sent to the model change. It is part of the cache key
// for the same reason the model name is: a different prompt is a different
// answer, even for the same content and model.
export const PROMPT_VERSION = {
  file: "file/v1",
  folder: "folder/v1",
  classify: "classify/v1",
} as const;

type WrappedClient = ReturnType<typeof wrapOpenAI>;

let cached: WrappedClient | null = null;

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Whether calls are being recorded. An absent tracing setup looks exactly like
// a working one that has seen no traffic, so this is surfaced to the reader.
export function tracingEnabled(): boolean {
  return (
    process.env.LANGSMITH_TRACING === "true" && Boolean(process.env.LANGSMITH_API_KEY)
  );
}

export function aiClient(): ReturnType<typeof wrapOpenAI> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  if (!cached) {
    cached = wrapOpenAI(new OpenAI({ apiKey }));
  }
  return cached;
}
