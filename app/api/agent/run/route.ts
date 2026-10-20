// Asking the agent a question.
//
// This is the only route that produces a scoped credential, and it produces one
// only after two things have happened in this order:
//
// 1. The viewer is signed in and has an active organization (`auth`).
// 2. The requested analysis is read back with the *viewer's own row-scoped
//    token*. An analysis in another organization comes back as nothing, which
//    is the same answer as one that does not exist.
//
// Only then is a credential minted, naming the organization the viewer is
// actually in and the analysis the viewer can actually see. A client that sends
// an analysis id it does not own gets a 404 and no credential — the id alone
// has never been enough.
//
// The credential goes to the agent service on a private port and is never sent
// to the browser. The browser talks to this route; this route talks to the
// agent. That hop is what keeps the signing secret and the database key out of
// reach of a page.

import { auth } from "@clerk/nextjs/server";

import { mintAnalysisCredential } from "@/lib/agent/mint";
import type { AgentStreamEvent, AgentTurnRequest } from "@/lib/agent/conversation";
import { getStoredAnalysis } from "@/lib/pipeline/load";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_QUESTION_CHARS = 4_000;
const MAX_SELECTED_PATH_CHARS = 512;
// A turn is a handful of tool calls and a streamed answer. Anything longer than
// this is a runaway, and the browser deserves a controlled failure rather than
// a hanging request.
const AGENT_TURN_TIMEOUT_MS = 90_000;

function agentServiceUrl(): string {
  const explicit = process.env.AGENT_SERVICE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return "http://127.0.0.1:8787";
}

interface ClientTurn {
  analysisId: string;
  message: string;
  selectedPath?: string;
  threadId?: string;
}

function readTurn(body: unknown): { ok: true; value: ClientTurn } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "The request body must be an object." };
  }
  const candidate = body as Record<string, unknown>;

  if (typeof candidate.analysisId !== "string" || candidate.analysisId.trim() === "") {
    return { ok: false, error: "`analysisId` is required." };
  }
  if (typeof candidate.message !== "string" || candidate.message.trim() === "") {
    return { ok: false, error: "`message` is required." };
  }
  if (candidate.message.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: `A question may be at most ${MAX_QUESTION_CHARS} characters.` };
  }
  if (
    candidate.selectedPath !== undefined &&
    (typeof candidate.selectedPath !== "string" || candidate.selectedPath.length > MAX_SELECTED_PATH_CHARS)
  ) {
    return { ok: false, error: "`selectedPath` must be a short string when present." };
  }
  if (candidate.threadId !== undefined && typeof candidate.threadId !== "string") {
    return { ok: false, error: "`threadId` must be a string when present." };
  }

  return {
    ok: true,
    value: {
      analysisId: candidate.analysisId.trim(),
      message: candidate.message.trim(),
      ...(typeof candidate.selectedPath === "string" ? { selectedPath: candidate.selectedPath } : {}),
      ...(typeof candidate.threadId === "string" ? { threadId: candidate.threadId } : {}),
    },
  };
}

export async function POST(request: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: "Choose a workspace first." }, { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return Response.json({ error: "The request body was not valid JSON." }, { status: 400 });
  }
  const turn = readTurn(parsedBody);
  if (!turn.ok) return Response.json({ error: turn.error }, { status: 400 });

  // Ownership, proven with the viewer's own token. This is the check that
  // makes the rest of the flow safe: nothing below can name an analysis the
  // viewer could not have opened on the page.
  const analysis = await getStoredAnalysis(createServerSupabaseClient(), turn.value.analysisId, {
    organizationId: orgId,
  });
  if (!analysis || analysis.status !== "complete" || !analysis.result) {
    return Response.json({ error: "That analysis has no finished map to ask about." }, { status: 404 });
  }

  let credential: string;
  try {
    credential = mintAnalysisCredential({ analysisId: analysis.id, organizationId: orgId });
  } catch {
    return Response.json(
      { error: "Agent conversations are not configured on this deployment." },
      { status: 503 },
    );
  }

  const base = agentServiceUrl();
  const headers = {
    authorization: `Bearer ${credential}`,
    "content-type": "application/json",
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_TURN_TIMEOUT_MS);

  try {
    // A new thread, or a continuation of the one this question belongs to.
    let threadId = turn.value.threadId;
    if (!threadId) {
      const created = await fetch(`${base}/threads`, {
        method: "POST",
        headers,
        signal: controller.signal,
      });
      if (!created.ok) {
        return Response.json(
          { error: "The agent service did not accept the conversation." },
          { status: 502 },
        );
      }
      const payload = (await created.json()) as { threadId?: unknown };
      if (typeof payload.threadId !== "string") {
        return Response.json({ error: "The agent service returned no conversation." }, { status: 502 });
      }
      threadId = payload.threadId;
    }

    const body: AgentTurnRequest = {
      messages: [{ role: "user", content: turn.value.message }],
      ...(turn.value.selectedPath ? { selectedPath: turn.value.selectedPath } : {}),
    };

    const upstream = await fetch(`${base}/threads/${threadId}/runs/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
      // A controlled error the panel can render, not a crash and not a hang.
      return Response.json(
        { error: "The agent service is unavailable.", threadId },
        { status: 503 },
      );
    }

    return streamTurn(upstream.body, threadId);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return Response.json(
      {
        error: aborted
          ? "The agent took too long to answer. Try a shorter question."
          : "The agent service could not be reached. Structure and Explanation still work.",
        ...(typeof turn.value.threadId === "string" ? { threadId: turn.value.threadId } : {}),
      },
      { status: aborted ? 504 : 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

// Relays the agent's event stream to the browser.
//
// Each event is parsed and checked against the shape the panel understands
// before it is forwarded, so anything unexpected from the agent never reaches
// the page as if it were a progress event. The thread id is handed back in the
// first event so the panel can carry the conversation on the next question
// without a second round trip.
function streamTurn(upstream: ReadableStream<Uint8Array>, threadId: string): Response {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.getReader();

  const send = (event: AgentStreamEvent) => `data: ${JSON.stringify(event)}\n\n`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = parseSseFrame(frame);
            if (event) controller.enqueue(encoder.encode(send(event)));
            boundary = buffer.indexOf("\n\n");
          }
        }
        // Anything left without a closing blank line is an incomplete event:
        // reported as an interrupted stream rather than shown as an answer.
        if (buffer.trim().length > 0) {
          controller.enqueue(
            encoder.encode(send({ type: "error", message: "The agent's answer was interrupted." })),
          );
        }
      } catch {
        controller.enqueue(
          encoder.encode(send({ type: "error", message: "The agent stopped sending mid-answer." })),
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      // The panel carries this back on the next question so the conversation
      // continues in one thread. It is an opaque id, not a credential: the
      // agent will not accept a thread without a matching scoped credential.
      "x-agent-thread-id": threadId,
    },
  });
}

const EVENT_TYPES = new Set(["token", "tool_call", "tool_result", "done", "error"]);

// Reads one `data:` frame and keeps only events the panel has a renderer for.
function parseSseFrame(frame: string): AgentStreamEvent | null {
  const line = frame.split("\n").find((candidate) => candidate.startsWith("data:"));
  if (!line) return null;
  const json = line.slice(5).trim();
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (typeof event.type !== "string" || !EVENT_TYPES.has(event.type)) return null;
  if (event.type === "token" && typeof event.text === "string") {
    return { type: "token", text: event.text };
  }
  if (event.type === "tool_call" && typeof event.name === "string" && typeof event.label === "string") {
    return { type: "tool_call", name: event.name, label: event.label };
  }
  if (
    event.type === "tool_result" &&
    typeof event.name === "string" &&
    typeof event.ok === "boolean" &&
    typeof event.summary === "string"
  ) {
    return { type: "tool_result", name: event.name, ok: event.ok, summary: event.summary };
  }
  if (event.type === "done" && typeof event.finishReason === "string") {
    return { type: "done", finishReason: event.finishReason };
  }
  if (event.type === "error" && typeof event.message === "string") {
    return { type: "error", message: event.message };
  }
  return null;
}
