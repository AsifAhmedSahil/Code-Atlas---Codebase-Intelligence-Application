"use client";

// The Explanation tab.
//
// It has one job in two halves: ask for an explanation of whatever is selected,
// and draw the answer back. The asking goes through a server action; the drawing
// understands only the three things the prompt permits — paragraphs, bullets and
// bold — plus inline code, and turns any repository path it meets into a link
// that moves the map.
//
// An answer already fetched this session is kept above the pane, so moving the
// selection away and back shows it again without a second click. A page load
// empties that session map, so on mount the panel asks the server what it has
// stored for this exact subject first: a persisted answer is drawn straight
// away, and only a genuine miss leaves the button. The server caches too, but a
// cache the reader cannot feel is not a cache.

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { parseExplanation, type Inline } from "@/lib/ai/format";
import { explanationKey, type ExplanationResult } from "@/lib/ai/subject";

import { explainSelected, restoreExplanation } from "@/app/(app)/explain-actions";
import { RerunButton } from "../rerun-button";
import { useWorkspace } from "./workspace-context";

type Subject = { kind: "file"; id: string } | { kind: "folder"; id: string };

export function ExplanationTab() {
  const { selection, folded, parse } = useWorkspace();

  const subject = useMemo<Subject | null>(() => {
    if (!selection) return null;
    if (selection.kind === "node") return { kind: "folder", id: selection.id };
    // The manifest is drawn but is not source, so it has no stored content to
    // explain and no hash to key an answer on.
    if (folded.manifestFiles.includes(selection.path)) return null;
    if (!parse.files.some((file) => file.path === selection.path)) return null;
    return { kind: "file", id: selection.path };
  }, [selection, folded.manifestFiles, parse.files]);

  if (!selection) {
    return (
      <div className="px-3 py-4">
        <p className="text-[12px] leading-relaxed text-muted">
          Select a file or a folder to explain it. The answer is written from what
          it actually imports and what actually imports it, and is kept so you can
          come back to it.
        </p>
      </div>
    );
  }

  if (!subject) {
    return (
      <div className="px-3 py-4">
        <p className="text-[12px] leading-relaxed text-muted">
          This file is not part of the analysed source, so there is nothing to
          explain.
        </p>
      </div>
    );
  }

  // Keying the panel on the subject resets its local loading state when the
  // selection changes, while the fetched answers stay in the provider above.
  return <ExplanationPanel key={`${subject.kind}\u0000${subject.id}`} subject={subject} />;
}

function ExplanationPanel({ subject }: { subject: Subject }) {
  const { analysisId, explanations, setExplanation, parse, setSelection } = useWorkspace();
  const key = explanationKey(analysisId, subject.kind, subject.id);
  const stored = explanations.get(key);
  const [pending, setPending] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const busy = pending || (!stored && restoring);

  const knownPaths = useMemo(
    () => new Set(parse.files.map((file) => file.path)),
    [parse.files],
  );

  // Read back what is already persisted for this subject before offering to
  // generate anything. An answer in the session map already means the server
  // answered once, so there is nothing to restore; a `null` answer is a real
  // miss and leaves the button. Set state only from the async callback: the
  // effect body itself must not trigger a render.
  useEffect(() => {
    if (stored) return;
    let cancelled = false;
    (async () => {
      try {
        const restored = await restoreExplanation(analysisId, subject.kind, subject.id);
        if (!cancelled && restored) setExplanation(key, restored);
      } catch {
        // Nothing to draw: the button below is the honest next step.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stored, analysisId, subject.kind, subject.id, key, setExplanation]);

  const request = async () => {
    if (busy) return;
    setPending(true);
    try {
      const result = await explainSelected(analysisId, subject.kind, subject.id);
      setExplanation(key, result);
    } catch {
      setExplanation(key, {
        status: "error",
        subjectKind: subject.kind,
        subjectId: subject.id,
        body: "",
        cached: false,
        model: "",
        tracing: false,
        staleness: { moved: false },
        message: "The request could not be sent.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      <SubjectLine subject={subject} />

      {stored ? (
        <ExplanationBody
          result={stored}
          knownPaths={knownPaths}
          onSelectPath={(path) => setSelection({ kind: "file", path })}
        />
      ) : (
        <ExplainPrompt subject={subject} pending={busy} onExplain={request} />
      )}

      {stored?.status === "ok" && <StalenessNote result={stored} analysisId={analysisId} />}

      {stored && !stored.tracing && stored.status === "ok" && (
        <p className="text-[11px] leading-relaxed text-muted/80">
          Tracing is off, so this call was not recorded. Set{" "}
          <span className="font-mono">LANGSMITH_API_KEY</span> to see runs.
        </p>
      )}
    </div>
  );
}

function SubjectLine({ subject }: { subject: Subject }) {
  return (
    <p className="text-[11px] text-muted">
      {subject.kind === "folder" ? "Folder" : "File"} ·{" "}
      <span className="break-all font-mono text-text">{subject.id}</span>
    </p>
  );
}

function ExplainPrompt({
  subject,
  pending,
  onExplain,
}: {
  subject: Subject;
  pending: boolean;
  onExplain: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[12px] leading-relaxed text-muted">
        {subject.kind === "folder"
          ? "Explain what this part of the repository is for. The answer is written from the files in it and the imports crossing its edge."
          : "Explain what this file does, from the files it imports and the files that import it."}
      </p>
      <button
        type="button"
        onClick={onExplain}
        disabled={pending}
        className="h-8 rounded-md bg-accent px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
      >
        {pending ? "Explaining…" : "Explain"}
      </button>
    </div>
  );
}

function ExplanationBody({
  result,
  knownPaths,
  onSelectPath,
}: {
  result: ExplanationResult;
  knownPaths: ReadonlySet<string>;
  onSelectPath: (path: string) => void;
}) {
  if (result.status !== "ok") {
    return (
      <p className="text-[12px] leading-relaxed text-outgoing">
        {result.message ?? "The explanation could not be written."}
      </p>
    );
  }

  const blocks = parseExplanation(result.body);

  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((block, index) =>
        block.kind === "bullets" ? (
          <ul key={index} className="flex list-disc flex-col gap-1 pl-4">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="text-[12px] leading-relaxed text-text">
                <Spans spans={item} knownPaths={knownPaths} onSelectPath={onSelectPath} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index} className="text-[12px] leading-relaxed text-text">
            <Spans spans={block.spans} knownPaths={knownPaths} onSelectPath={onSelectPath} />
          </p>
        ),
      )}
      <p className="pt-1 text-[10px] text-muted/80">
        {result.cached ? "From cache · " : ""}
        {result.model}
      </p>
    </div>
  );
}

function Spans({
  spans,
  knownPaths,
  onSelectPath,
}: {
  spans: readonly Inline[];
  knownPaths: ReadonlySet<string>;
  onSelectPath: (path: string) => void;
}) {
  return (
    <>
      {spans.map((span, index) => {
        if (span.kind === "code") {
          const path = span.text.trim();
          if (knownPaths.has(path)) {
            return (
              <PathLink key={index} path={path} onSelectPath={onSelectPath}>
                {span.text}
              </PathLink>
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
        const linked = splitPaths(span.text, knownPaths, onSelectPath);
        if (span.kind === "bold") {
          return <strong key={index}>{linked}</strong>;
        }
        return <span key={index}>{linked}</span>;
      })}
    </>
  );
}

// Every path in a plain run becomes a link; everything between them is left
// exactly as written. A path is only linked if it is a file this repository
// actually contains, so a stray word never pretends to be one.
function splitPaths(
  text: string,
  knownPaths: ReadonlySet<string>,
  onSelectPath: (path: string) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const token = /[^\s]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text)) !== null) {
    const raw = match[0];
    const core = raw.replace(/[.,;:)\]}'"]+$/, "");
    if (core.length === 0 || !knownPaths.has(core)) continue;
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(
      <PathLink key={match.index} path={core} onSelectPath={onSelectPath}>
        {core}
      </PathLink>,
    );
    const trailing = raw.slice(core.length);
    if (trailing) nodes.push(trailing);
    last = match.index + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function PathLink({
  path,
  onSelectPath,
  children,
}: {
  path: string;
  onSelectPath: (path: string) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={`Go to ${path}`}
      onClick={() => onSelectPath(path)}
      className="break-all text-left font-mono text-accent transition hover:underline"
    >
      {children}
    </button>
  );
}

function StalenessNote({
  result,
  analysisId,
}: {
  result: ExplanationResult;
  analysisId: string;
}) {
  if (!result.staleness.moved) return null;
  const changed = result.staleness.fileChanged === true;
  return (
    <div className="mt-1 flex flex-col items-start gap-2 rounded-md border border-border bg-raised p-3">
      <p className="text-[11px] leading-relaxed text-muted">
        {changed
          ? "This file has changed in the repository since this analysis. The explanation above describes the version that was analysed."
          : "The repository has moved past the commit this analysis was taken at, so this may no longer describe it."}
      </p>
      <RerunButton analysisId={analysisId} label="Re-analyse" />
    </div>
  );
}
