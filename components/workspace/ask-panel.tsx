"use client";

// Ask mode: the right-hand pane's third state, and a mode rather than a tab.
//
// It replaces whatever the pane was showing; leaving it puts the previous tab
// and the selected file back, because neither was cleared on the way in. That
// is the difference between a mode and a tab — a tab hides the others, a mode
// takes over the pane and hands it back unchanged.
//
// Everything about a question goes out as one POST and comes back as a stream
// of events. Tokens append as they arrive; tool calls appear as they happen, so
// a question that needs four lookups shows four rather than one spinner. The
// thread id rides in a response header and comes back with the next question,
// so the conversation continues in one thread without the browser holding any
// credential — it holds an opaque id that is worthless without one.

import { useMemo, useRef, useState } from "react";

import { parseExplanation, type Inline } from "@/lib/ai/format";

import { useWorkspace } from "./workspace-context";

type Turn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "error"; content: string };

type Status = "idle" | "streaming";

// The progress line names the tool being called rather than spinning. A
// question about a repository is answered by reading it; the reader deserves
// to see what is being read.
interface Progress {
  label: string;
  result?: { ok: boolean; summary: string };
}

const MAX_QUESTIONS = 400;

export function AskPanel({ onClose }: { onClose: () => void }) {
  const { analysisId, parse, selection } = useWorkspace();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<Progress[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const selectedPath = selection?.kind === "file" ? selection.path : null;
  const knownPaths = useMemo(
    () => new Set(parse.files.map((file) => file.path)),
    [parse.files],
  );

  const busy = status === "streaming";

  const ask = async () => {
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    setStatus("streaming");
    setProgress([]);
    setTurns((current) => [...current, { role: "user", content: question }]);

    const controller = new AbortController();
    abortRef.current = controller;

    let answer = "";
    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          analysisId,
          message: question,
          ...(selectedPath ? { selectedPath } : {}),
          ...(threadId ? { threadId } : {}),
        }),
        signal: controller.signal,
      });

      const returnedThread = response.headers.get("x-agent-thread-id");
      if (returnedThread) setThreadId(returnedThread);

      if (!response.ok || !response.body) {
        // A controlled failure the reader can act on. Nothing about Structure
        // or Explanation changes because of this.
        const detail = await readErrorDetail(response);
        setTurns((current) => [...current, { role: "error", content: detail }]);
        return;
      }

      for await (const event of readEvents(response.body)) {
        if (event.type === "token") {
          answer += event.text;
          // The streamed answer is drawn in place, so a long reply is readable
          // as it is written rather than after a pause.
          setTurns((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { role: "assistant", content: answer };
            else next.push({ role: "assistant", content: answer });
            return next;
          });
        } else if (event.type === "tool_call") {
          setProgress((current) => [...current, { label: event.label }]);
        } else if (event.type === "tool_result") {
          setProgress((current) => {
            const next = [...current];
            for (let index = next.length - 1; index >= 0; index--) {
              if (!next[index].result) {
                next[index] = { ...next[index], result: { ok: event.ok, summary: event.summary } };
                break;
              }
            }
            return next;
          });
        } else if (event.type === "error") {
          setTurns((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            // A stream that failed after some tokens still shows them; only an
            // empty assistant turn is replaced by the error.
            if (last?.role === "assistant" && last.content.trim() === "") next.pop();
            next.push({ role: "error", content: event.message });
            return next;
          });
        }
      }

      if (!answer.trim()) {
        setTurns((current) => [
          ...current,
          { role: "error", content: "The agent returned no answer. Try asking again." },
        ]);
      }
    } catch {
      if (!controller.signal.aborted) {
        setTurns((current) => [
          ...current,
          {
            role: "error",
            content: "The agent could not be reached. Structure and Explanation still work.",
          },
        ]);
      }
    } finally {
      abortRef.current = null;
      setStatus("idle");
      setProgress([]);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-text">Ask about this analysis</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            {selectedPath ? (
              <>
                About{" "}
                <span className="break-all font-mono text-text">{selectedPath}</span>. Clear the
                selection to ask about the repository.
              </>
            ) : (
              "No file is selected, so questions are about the repository as a whole."
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 cursor-pointer text-[11px] text-muted transition hover:text-text"
        >
          Close
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {turns.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-3">
            {turns.map((turn, index) => (
              <TurnView key={index} turn={turn} knownPaths={knownPaths} />
            ))}
          </div>
        )}

        {progress.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-2">
            {progress.map((item, index) => (
              <li key={index} className="flex items-baseline gap-2 text-[11px]">
                <span className={item.result ? (item.result.ok ? "text-muted" : "text-outgoing") : "text-accent"}>
                  {item.result ? (item.result.ok ? "✓" : "✕") : "…"}
                </span>
                <span className="text-muted">
                  {item.label}
                  {item.result ? ` · ${item.result.summary}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_QUESTIONS))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
            rows={2}
            placeholder="Ask what uses a file, what would break, which routes exist…"
            className="w-full resize-none rounded-md border border-border bg-raised px-2 py-1.5 text-[12px] leading-relaxed text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted/80">Enter to ask · Shift+Enter for a new line</p>
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="h-7 cursor-pointer rounded-md border border-border px-3 text-[12px] text-text transition hover:bg-raised"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void ask()}
                disabled={draft.trim().length === 0}
                className="h-7 cursor-pointer rounded-md bg-accent px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              >
                Ask
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] leading-relaxed text-muted">
        Ask a question about this repository. Answers come from the dependency map: files, imports,
        roles and routes as they were analysed. Nothing is guessed.
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] leading-relaxed text-muted">
        <li>What would break if I changed a file?</li>
        <li>What does this file depend on, and what depends on it?</li>
        <li>Which files are services, and which are imported by nothing?</li>
        <li>Does a route exist for a given path?</li>
      </ul>
    </div>
  );
}

function TurnView({
  turn,
  knownPaths,
}: {
  turn: Turn;
  knownPaths: ReadonlySet<string>;
}) {
  if (turn.role === "user") {
    return (
      <div className="rounded-md border border-border bg-raised px-2.5 py-2">
        <p className="break-words text-[12px] leading-relaxed text-text">{turn.content}</p>
      </div>
    );
  }
  if (turn.role === "error") {
    return <p className="text-[12px] leading-relaxed text-outgoing">{turn.content}</p>;
  }
  return <GroundedText text={turn.content} knownPaths={knownPaths} />;
}

// The same three block shapes the Explanation tab understands — paragraphs,
// bullets and bold — plus inline code, with any repository path turned into a
// link that moves the map. A path is only linked when it is a file this
// analysis actually contains, so a stray word never pretends to be one.
function GroundedText({ text, knownPaths }: { text: string; knownPaths: ReadonlySet<string> }) {
  const blocks = parseExplanation(text);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) =>
        block.kind === "bullets" ? (
          <ul key={index} className="flex list-disc flex-col gap-1 pl-4">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="text-[12px] leading-relaxed text-text">
                <Spans spans={item} knownPaths={knownPaths} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index} className="text-[12px] leading-relaxed text-text">
            <Spans spans={block.spans} knownPaths={knownPaths} />
          </p>
        ),
      )}
    </div>
  );
}

function Spans({ spans, knownPaths }: { spans: readonly Inline[]; knownPaths: ReadonlySet<string> }) {
  const { setSelection } = useWorkspace();
  return (
    <>
      {spans.map((span, index) => {
        if (span.kind === "code") {
          const path = span.text.trim();
          if (knownPaths.has(path)) {
            return (
              <button
                key={index}
                type="button"
                title={`Go to ${path}`}
                onClick={() => setSelection({ kind: "file", path })}
                className="break-all text-left font-mono text-accent transition hover:underline"
              >
                {span.text}
              </button>
            );
          }
          return (
            <code
              key={index}
              className="rounded bg-raised px-1 py-px font-mono text-[11px] text-text"
            >
              {span.text}
            </code>
          );
        }
        const linked = splitPaths(span.text, knownPaths, (path) =>
          setSelection({ kind: "file", path }),
        );
        if (span.kind === "bold") return <strong key={index}>{linked}</strong>;
        return <span key={index}>{linked}</span>;
      })}
    </>
  );
}

function splitPaths(
  text: string,
  knownPaths: ReadonlySet<string>,
  onSelectPath: (path: string) => void,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const token = /[^\s]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text)) !== null) {
    const raw = match[0];
    const core = raw.replace(/[.,;:)\]}'"]+$/, "");
    if (core.length === 0 || !knownPaths.has(core)) continue;
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(
      <button
        key={match.index}
        type="button"
        title={`Go to ${core}`}
        onClick={() => onSelectPath(core)}
        className="break-all text-left font-mono text-accent transition hover:underline"
      >
        {core}
      </button>,
    );
    const trailing = raw.slice(core.length);
    if (trailing) nodes.push(trailing);
    last = match.index + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      typeof (body as { error?: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // Fall through to the generic sentence.
  }
  return "The agent could not answer that.";
}

// Reads the agent's event stream. `EventSource` cannot POST, so the stream is
// read from the fetch response by hand — one `data:` frame at a time.
async function* readEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
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
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type StreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; label: string }
  | { type: "tool_result"; name: string; ok: boolean; summary: string }
  | { type: "done"; finishReason: string }
  | { type: "error"; message: string };

function parseFrame(frame: string): StreamEvent | null {
  const line = frame.split("\n").find((candidate) => candidate.startsWith("data:"));
  if (!line) return null;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(5).trim());
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.type === "token" && typeof event.text === "string") return { type: "token", text: event.text };
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
