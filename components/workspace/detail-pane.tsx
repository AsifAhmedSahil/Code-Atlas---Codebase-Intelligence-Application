"use client";

// The detail pane on the right. Its resting state is the repository summary —
// what this codebase is, not a prompt to select something. A selection replaces
// it with that file's or folder's structure. Two tabs sit above both, and which
// one is open survives changing the selection.
//
// Everything here is arithmetic over data already in the browser: selecting
// fires no request. Every path is clickable and moves the map's selection;
// hovering one highlights it on the map.

import { useMemo, useState } from "react";

import {
  folderImportStats,
  mostDependedOn,
  neighboursOf,
  unimportedFiles,
} from "@/lib/map/detail";
import { buildInsights, type Insight } from "@/lib/map/insights";
import { basename } from "@/lib/map/labels";
import { walkGraph, type WalkDirection } from "@/lib/map/walk";
import { adapterFor } from "@/lib/parser/adapter";
import type { Edge } from "@/lib/parser/types";

import { countCategories, fileKind, kindLabel, type FileCategory } from "./categories";
import { useWorkspace } from "./workspace-context";

type Tab = "structure" | "explanation";

const SUMMARY_LIMIT = 10;

// Blast radius and the dependency chain both read two hops out. Deeper levels
// stop being about this file and start being about the repository.
const WALK_DEPTH = 2;

export function DetailPane() {
  const [tab, setTab] = useState<Tab>("structure");

  return (
    <aside
      aria-label="Detail pane"
      className="flex w-80 shrink-0 flex-col border-l border-border bg-surface"
    >
      <div className="flex h-9 shrink-0 items-stretch gap-1 border-b border-border px-1">
        <TabButton active={tab === "structure"} onClick={() => setTab("structure")}>
          Structure
        </TabButton>
        <TabButton active={tab === "explanation"} onClick={() => setTab("explanation")}>
          Explanation
        </TabButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === "structure" ? <StructureTab /> : <ExplanationTab />}
      </div>
      <InsightsPanel />
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative cursor-pointer px-3 text-[12px] transition ${
        active
          ? "text-text after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-accent"
          : "text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function StructureTab() {
  const { selection } = useWorkspace();
  if (!selection) return <RepoOverview />;
  if (selection.kind === "node") return <FolderOverview id={selection.id} />;
  return <FileOverview path={selection.path} />;
}

// The first thing anyone sees. Name, framework and three summary columns, then
// the two ranked lists: what everything leans on, and what nothing imports, and
// a status row saying how much the framework adapter could actually tell us.
function RepoOverview() {
  const { parse } = useWorkspace();
  const frameworks = parse.adapter === "none" ? "None detected" : parse.adapter;
  const depended = useMemo(() => mostDependedOn(parse.files, SUMMARY_LIMIT), [parse.files]);
  const unimported = useMemo(() => unimportedFiles(parse.files), [parse.files]);
  const shown = unimported.slice(0, SUMMARY_LIMIT);

  return (
    <div className="flex flex-col pb-4">
      <div className="px-3 pt-3">
        <h2 className="truncate font-mono text-[14px] font-medium text-text">{parse.root}</h2>
        <p className="mt-0.5 text-[11px] text-muted">Framework · {frameworks}</p>
      </div>

      <div className="mt-3 grid grid-cols-3 divide-x divide-border border-y border-border">
        <SummaryColumn
          label="Files"
          value={String(parse.counts.parsed)}
          secondary={`${parse.counts.skipped} skipped`}
        />
        <SummaryColumn
          label="Imports"
          value={String(parse.edges.length)}
          secondary={`${parse.coverage.importsSeen} seen`}
        />
        <SummaryColumn label="Routes" value="—" secondary="none detected" />
      </div>

      <SectionHeader>Most depended on by files importing it</SectionHeader>
      {depended.length === 0 ? (
        <Empty>Nothing is imported by another file.</Empty>
      ) : (
        <ul>
          {depended.map((file) => (
            <PathRow key={file.path} path={file.path} count={file.fanIn} tone="incoming" arrow />
          ))}
        </ul>
      )}

      <SectionHeader count={unimported.length}>Imported by nothing when reading starts</SectionHeader>
      {unimported.length === 0 ? (
        <Empty>Every file is imported by something.</Empty>
      ) : (
        <>
          <ul>
            {shown.map((file) => (
              <PathRow
                key={file.path}
                path={file.path}
                count={file.fanOut}
                marker="bg-outgoing"
              />
            ))}
          </ul>
          {unimported.length > shown.length && (
            <p className="px-3 pt-1 text-[11px] tabular-nums text-muted">
              {unimported.length - shown.length} more
            </p>
          )}
        </>
      )}

      <div className="mt-4 border-t border-border px-3 pt-3">
        <p className="text-[11px] leading-relaxed text-muted">
          Framework adapter · {frameworks}. Routes and conventions are not detected.
        </p>
      </div>
    </div>
  );
}

function FileOverview({ path }: { path: string }) {
  const { parse, fileByPath } = useWorkspace();
  const [walk, setWalk] = useState<WalkDirection | null>(null);
  const file = fileByPath.get(path);
  const { dependencies, dependents } = useMemo(
    () => neighboursOf(path, parse.edges),
    [path, parse.edges],
  );

  const weight = (target: string) => fileByPath.get(target)?.fanIn;

  return (
    <div className="flex flex-col pb-4">
      <div className="px-3 pt-3">
        <Breadcrumb path={path} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border px-3 pt-3">
        <Meta label="Kind" value={file ? kindLabel(fileKind(file)) : "Unknown"} />
        <Meta label="Lines" value={file ? String(file.lines) : "—"} />
        <Meta label="Folder" value={file?.folder ?? "—"} mono span />
        <Meta
          label="Dependencies"
          value={String(dependencies.length)}
          tone="outgoing"
        />
        <Meta label="Dependents" value={String(dependents.length)} tone="incoming" />
      </dl>

      <div className="flex gap-1.5 px-3 pt-3">
        <WalkButton
          active={walk === "in"}
          onClick={() => setWalk((current) => (current === "in" ? null : "in"))}
        >
          Blast radius
        </WalkButton>
        <WalkButton
          active={walk === "out"}
          onClick={() => setWalk((current) => (current === "out" ? null : "out"))}
        >
          Dependency chain
        </WalkButton>
      </div>

      {walk ? (
        <WalkSection key={walk} path={path} edges={parse.edges} direction={walk} />
      ) : (
        <>
          <SectionHeader count={dependencies.length}>Imports</SectionHeader>
          {dependencies.length === 0 ? (
            <Empty>This file imports nothing inside the repository.</Empty>
          ) : (
            <ul>
              {dependencies.map((target) => (
                <PathRow key={target} path={target} count={weight(target)} tone="outgoing" />
              ))}
            </ul>
          )}

          <SectionHeader count={dependents.length}>Imported by</SectionHeader>
          {dependents.length === 0 ? (
            <Empty>Nothing imports this file.</Empty>
          ) : (
            <ul>
              {dependents.map((source) => (
                <PathRow key={source} path={source} count={weight(source)} tone="incoming" />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// One of the two transitive views. They answer different questions — what breaks
// (blast radius, inward) and what this needs (dependency chain, outward) — and
// both are the same walk, so the copy is the only thing that differs.
function WalkSection({
  path,
  edges,
  direction,
}: {
  path: string;
  edges: readonly Edge[];
  direction: WalkDirection;
}) {
  const levels = useMemo(
    () => walkGraph(path, edges, direction, WALK_DEPTH),
    [path, edges, direction],
  );
  const total = levels.reduce((sum, level) => sum + level.paths.length, 0);
  const heading = direction === "in" ? "Blast radius" : "Dependency chain";

  if (total === 0) {
    return (
      <>
        <SectionHeader>{heading}</SectionHeader>
        <Empty>
          {direction === "in"
            ? "Nothing imports this file, so changing it breaks nothing else."
            : "This file imports nothing else in the repository."}
        </Empty>
      </>
    );
  }

  return (
    <>
      <SectionHeader count={total}>
        {`${heading} · ${WALK_DEPTH} levels`}
      </SectionHeader>
      {levels.map((level) => (
        <div key={level.depth}>
          <p className="px-3 pb-0.5 pt-2 text-[10px] text-muted">
            {level.depth === 1 ? "Direct" : `${level.depth} steps away`}
          </p>
          <ul>
            {level.paths.map((target) => (
              <PathRow key={target} path={target} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function WalkButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`cursor-pointer rounded-[4px] border px-2 py-0.5 text-[11px] transition ${
        active
          ? "border-accent/60 bg-accent/10 text-accent"
          : "border-border text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function FolderOverview({ id }: { id: string }) {
  const { parse, labels, fileByPath, nodeById, folded } = useWorkspace();
  const node = nodeById.get(id);
  const composition = useMemo<FileCategory[]>(() => {
    if (!node) return [];
    const files = node.files
      .map((file) => fileByPath.get(file))
      .filter((file): file is NonNullable<typeof file> => file !== undefined);
    return countCategories(files);
  }, [node, fileByPath]);
  const stats = useMemo(
    () =>
      node
        ? folderImportStats(node.files, id, folded.fileToNode, parse.edges)
        : undefined,
    [node, id, folded, parse.edges],
  );

  if (!node || !stats) return <Empty>This folder is not on the map.</Empty>;

  const label = labels[id] ?? id;

  return (
    <div className="flex flex-col pb-4">
      <div className="px-3 pt-3">
        <h2 className="truncate font-mono text-[14px] font-medium text-text">{label}</h2>
        <p className="break-all font-mono text-[11px] text-muted">
          {id === "." ? "." : id}
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border px-3 pt-3">
        <Meta label="Files" value={String(stats.total)} />
        <Meta label="Imported from outside" value={String(stats.fromOutside)} tone="incoming" />
        <Meta label="Imported from within" value={String(stats.fromWithin)} />
      </dl>

      <SectionHeader>Kinds of file inside</SectionHeader>
      <ul>
        {composition.map((category) => (
          <KindRow key={category.kind} category={category} />
        ))}
      </ul>
    </div>
  );
}

function ExplanationTab() {
  return (
    <div className="px-3 py-4">
      <p className="text-[12px] leading-relaxed text-muted">
        No explanation yet. This tab fills in once there is a model call to write one.
      </p>
    </div>
  );
}

// The insights sit under everything and start closed, so they are never the
// first thing you see. Each one is a sentence read off the edge list, not a
// verdict, and the count is whole even when the list underneath is shortened.
function InsightsPanel() {
  const { parse } = useWorkspace();
  const [open, setOpen] = useState(false);
  const insights = useMemo(() => {
    const patterns = adapterFor(parse.adapter).entryPoints ?? [];
    const isEntryPoint = (path: string) =>
      patterns.some((pattern) => pattern.test(path));
    return buildInsights(parse.files, parse.edges, isEntryPoint);
  }, [parse]);

  return (
    <section className="shrink-0 border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-[11px] text-muted transition hover:text-text"
      >
        <span className="font-medium">Insights</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="scroll-thin max-h-[45vh] overflow-y-auto border-t border-border pb-3">
          {insights.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-muted">
              Nothing stands out from this repository&apos;s edges.
            </p>
          ) : (
            insights.map((insight) => (
              <InsightSection key={insight.kind} insight={insight} />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function InsightSection({ insight }: { insight: Insight }) {
  const hidden =
    insight.kind === "cycle"
      ? insight.total - insight.groups.length
      : insight.total - (insight.groups[0]?.length ?? 0);
  return (
    <div className="pb-1 pt-3">
      <div className="flex items-baseline justify-between gap-2 px-3 pb-1">
        <p className="text-[11px] leading-snug text-muted">{insight.sentence}</p>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
          {insight.total}
        </span>
      </div>
      {insight.groups.map((group, index) => (
        <ul
          key={index}
          className={index > 0 ? "mt-1 border-t border-border/60 pt-1" : undefined}
        >
          {group.map((path) => (
            <PathRow key={`${index}:${path}`} path={path} />
          ))}
        </ul>
      ))}
      {hidden > 0 && (
        <p className="px-3 pt-1 text-[11px] tabular-nums text-muted">{hidden} more</p>
      )}
    </div>
  );
}

// The path, breadcrumb-style: the directory truncates from the left so the file
// name always stays, and the whole line never wraps.
function Breadcrumb({ path }: { path: string }) {
  const base = basename(path);
  const dir = path.slice(0, path.length - base.length);
  return (
    <div className="flex items-baseline font-mono text-[12px] leading-snug" title={path}>
      {dir && <span className="min-w-0 truncate text-muted">{dir}</span>}
      <span className="shrink-0 text-text">{base}</span>
    </div>
  );
}

function SummaryColumn({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary: string;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="font-mono text-[16px] leading-tight tabular-nums text-text">{value}</div>
      <div className="mt-0.5 text-[10px] text-muted/70">{secondary}</div>
    </div>
  );
}

// One metadata cell. Counts that pair with a direction carry that direction's
// colour; everything else reads as plain text.
function Meta({
  label,
  value,
  mono,
  tone,
  span,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "incoming" | "outgoing";
  span?: boolean;
}) {
  const toneClass =
    tone === "incoming" ? "text-incoming" : tone === "outgoing" ? "text-outgoing" : "text-text";
  return (
    <div className={span ? "col-span-2" : undefined}>
      <dt className="text-[10px] text-muted">{label}</dt>
      <dd className={`truncate text-[12px] tabular-nums ${mono ? "font-mono" : ""} ${toneClass}`}>
        {value}
      </dd>
    </div>
  );
}

function SectionHeader({
  children,
  count,
}: {
  children: string;
  count?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 pb-1 pt-4">
      <span className="text-[11px] font-medium text-muted">{children}</span>
      {count !== undefined && (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{count}</span>
      )}
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="px-3 text-[11px] text-muted">{children}</p>;
}

// One path in the pane: clickable, hovers onto the map, and lights up when the
// map hovers back. An optional leading marker and a right-aligned count.
function PathRow({
  path,
  count,
  tone = "muted",
  arrow,
  marker,
}: {
  path: string;
  count?: number;
  tone?: "muted" | "incoming" | "outgoing";
  arrow?: boolean;
  marker?: string;
}) {
  const { setSelection, setHover, hover, folded } = useWorkspace();
  // Lit either because the pane is hovering it, or because the map is hovering
  // the node this path lives in.
  const active =
    (hover?.kind === "file" && hover.path === path) ||
    (hover?.kind === "node" && folded.fileToNode[path] === hover.id);
  const toneClass =
    tone === "incoming" ? "text-incoming" : tone === "outgoing" ? "text-outgoing" : "text-muted";
  return (
    <li>
      <button
        type="button"
        title={path}
        onClick={() => setSelection({ kind: "file", path })}
        onMouseEnter={() => setHover({ kind: "file", path })}
        onMouseLeave={() => setHover(null)}
        className={`flex w-full items-center gap-2 px-3 py-1 text-left font-mono text-[11px] transition ${
          active ? "bg-accent/10 text-text" : "text-text/85 hover:bg-accent/5"
        }`}
      >
        {marker && (
          <span className={`size-1.5 shrink-0 rounded-[2px] ${marker}`} aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{path}</span>
        {count !== undefined && (
          <span className={`flex shrink-0 items-center gap-0.5 tabular-nums ${toneClass}`}>
            {arrow && <span aria-hidden>↑</span>}
            {count}
          </span>
        )}
      </button>
    </li>
  );
}

function KindRow({ category }: { category: FileCategory }) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-1.5">
      <span className={`size-2 shrink-0 rounded-[2px] ${category.swatch}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[12px] text-text">{category.name}</span>
      <span className="font-mono text-[11px] tabular-nums text-muted">{category.count}</span>
    </li>
  );
}
