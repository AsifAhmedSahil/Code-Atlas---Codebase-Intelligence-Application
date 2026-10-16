"use client";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { MapEdge, MapNode } from "@/lib/map/fold";
import { basename } from "@/lib/map/labels";
import { matchCategory } from "@/lib/map/match";

import { layoutNodes } from "./map-layout";
import { useWorkspace } from "./workspace-context";

import "@xyflow/react/dist/style.css";

export interface GraphDatum {
  nodes: MapNode[];
  edges: MapEdge[];
  labels: Record<string, string>;
}

interface FolderNodeData {
  [key: string]: unknown;
  label: string;
  fileCount: number;
  files: string[];
  fanIn: number;
  fanOut: number;
  expanded: boolean;
  size: { width: number; height: number };
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onSelectNode: (id: string) => void;
  onSelectFile: (file: string) => void;
  onScroll: (id: string) => void;
  selected: boolean;
  selectedFile: string | null;
  dimmed: boolean;
  rowDim: ReadonlySet<string> | null;
  // Manifest files shown in this panel: not source, so no edge touches them and
  // their rows rest dimmed.
  manifest: ReadonlySet<string>;
  // The files in this node that match the rail's chosen kind, or null when no
  // kind is chosen. Rows outside it dim, and its size is the panel's match count.
  matched: ReadonlySet<string> | null;
}

type FolderNode = Node<FolderNodeData, "folder">;

const nodeTypes = { folder: FolderNodeComponent };
const edgeTypes = { flow: FlowEdge };

type FlowEdge = Edge<Record<string, unknown>, "flow">;

// The same control-point logic React Flow uses for its bezier edges, so the
// two halves below meet whatever curve the built-ins would have drawn.
function controlWithCurvature(
  position: Position,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  curvature: number,
): { x: number; y: number } {
  const c = Math.abs(x2 - x1) * curvature;
  const d = Math.abs(y2 - y1) * curvature;
  switch (position) {
    case Position.Left:
      return { x: x1 - c, y: y1 };
    case Position.Right:
      return { x: x1 + c, y: y1 };
    case Position.Top:
      return { x: x1, y: y1 - d };
    case Position.Bottom:
      return { x: x1, y: y1 + d };
  }
}

// A dependency edge carries direction. The half leaving a module is its export
// or outgoing flow, painted gold; the half entering a module is the import
// flow, painted green. Splitting the bezier at its midpoint keeps the change
// smooth, and the arrowhead lands on the green, incoming end.
function FlowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
}: EdgeProps<FlowEdge>) {
  const curvature = 0.25;
  const p0 = { x: sourceX, y: sourceY };
  const p1 = { x: targetX, y: targetY };
  const c0 = controlWithCurvature(sourcePosition, sourceX, sourceY, targetX, targetY, curvature);
  const c1 = controlWithCurvature(targetPosition, targetX, targetY, sourceX, sourceY, curvature);
  const mid = {
    x: (p0.x + 3 * c0.x + 3 * c1.x + p1.x) / 8,
    y: (p0.y + 3 * c0.y + 3 * c1.y + p1.y) / 8,
  };
  const p01 = { x: (p0.x + c0.x) / 2, y: (p0.y + c0.y) / 2 };
  const p12 = { x: (c0.x + c1.x) / 2, y: (c0.y + c1.y) / 2 };
  const p23 = { x: (c1.x + p1.x) / 2, y: (c1.y + p1.y) / 2 };
  const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };
  const p123 = { x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2 };
  const outPath = `M ${p0.x},${p0.y} C ${p01.x},${p01.y} ${p012.x},${p012.y} ${mid.x},${mid.y}`;
  const inPath = `M ${mid.x},${mid.y} C ${p123.x},${p123.y} ${p23.x},${p23.y} ${p1.x},${p1.y}`;
  const markerId = `arrow-${id}`;
  return (
    <g>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--color-incoming)" />
        </marker>
      </defs>
      <path
        id={`${id}-out`}
        d={outPath}
        fill="none"
        style={{ ...style, stroke: "var(--color-outgoing)", strokeWidth: 1.2 }}
      />
      <path
        id={`${id}-in`}
        d={inPath}
        fill="none"
        style={{ ...style, stroke: "var(--color-incoming)", strokeWidth: 1.2 }}
        markerEnd={`url(#${markerId})`}
      />
    </g>
  );
}

function dot(kind: "target" | "source", id: string) {
  const incoming = kind === "target";
  return (
    <Handle
      type={kind}
      position={incoming ? Position.Left : Position.Right}
      id={id}
      style={{
        width: 5,
        height: 5,
        border: "none",
        borderRadius: "50%",
        background: incoming ? "var(--color-incoming)" : "var(--color-outgoing)",
      }}
    />
  );
}

// A click on a folded node opens it into a panel and selects it. Inside a
// panel, a row selects that file, and the panel background selects the module.
// The header closes it again.
function FolderNodeComponent({ id, data }: NodeProps<FolderNode>) {
  const {
    label,
    fileCount,
    files,
    fanIn,
    fanOut,
    expanded,
    size,
    selected,
    dimmed,
    matched,
  } = data;
  const { hover, setHover } = useWorkspace();

  // The map answers the pane's hover as well as its own: a file highlighted over
  // in the pane lights its row here, and hovering a file in a pane lights the
  // node when that node is folded.
  const nodeHovered =
    hover?.kind === "node"
      ? hover.id === id
      : hover?.kind === "file"
        ? files.includes(hover.path)
        : false;

  const nodeStyle: CSSProperties = {
    width: size.width,
    height: size.height,
    opacity: dimmed ? 0.3 : 1,
    transition: "opacity 160ms ease",
  };
  const selectedClass = selected ? "border-accent/70 ring-1 ring-accent/40" : "";
  const hoverClass = nodeHovered && !selected ? "border-accent/60 ring-1 ring-accent/30" : "";

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => data.onOpen(id)}
        onMouseEnter={() => setHover({ kind: "node", id })}
        onMouseLeave={() => setHover(null)}
        style={nodeStyle}
        className={`pointer-events-auto relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[6px] border border-border bg-raised font-mono text-text shadow-sm transition hover:border-accent/60 ${selectedClass} ${hoverClass}`}
      >
        <span className="w-full truncate px-3 text-center text-[12px]">{label}</span>
        <span className="w-full truncate px-3 text-center text-[10.5px] tabular-nums text-muted">
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
        {dot("target", "target")}
        {dot("source", "source")}
      </button>
    );
  }

  return (
    <div
      style={nodeStyle}
      onClick={() => data.onSelectNode(id)}
      className={`pointer-events-auto relative flex flex-col overflow-hidden rounded-[6px] border border-border bg-raised font-mono shadow-sm transition ${selectedClass} ${hoverClass}`}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          data.onClose(id);
        }}
        onMouseEnter={() => setHover({ kind: "node", id })}
        onMouseLeave={() => setHover(null)}
        className="flex h-[44px] w-full shrink-0 cursor-pointer items-baseline gap-2 rounded-t-[6px] border-b border-border bg-raised px-2.5 text-left transition hover:border-accent/60"
      >
        <span className="min-w-0 truncate text-[12px] font-medium text-text">{label}</span>
        <span className="ml-auto shrink-0 whitespace-nowrap text-[10.5px] tabular-nums text-muted">
          {matched ? `${matched.size} of ${fileCount} match` : `${fileCount} · in ${fanIn} · out ${fanOut}`}
        </span>
      </button>
      <div
        onScroll={() => data.onScroll(id)}
        className="scroll-thin nowheel min-h-0 flex-1 overflow-y-auto"
      >
        {files.map((file) => {
          const isSelectedFile = data.selectedFile === file;
          const isHoveredFile = hover?.kind === "file" && hover.path === file;
          const lit = isSelectedFile || isHoveredFile;
          const isManifest = data.manifest.has(file);
          const dimRow =
            !lit &&
            (isManifest ||
              (data.rowDim !== null && !data.rowDim.has(file)) ||
              (data.matched !== null && !data.matched.has(file)));
          return (
            <div
              key={file}
              onClick={(event) => {
                event.stopPropagation();
                data.onSelectFile(file);
              }}
              onMouseEnter={() => setHover({ kind: "file", path: file })}
              onMouseLeave={() => setHover(null)}
              style={{ opacity: dimRow ? 0.25 : 1, transition: "opacity 160ms ease" }}
              className={`relative flex h-6 shrink-0 cursor-pointer items-center border-b border-border/60 px-2.5 text-[11px] text-text/90 hover:bg-accent/5 ${
                isSelectedFile || isHoveredFile ? "bg-accent/10" : ""
              }`}
            >
              {isManifest ? null : dot("target", `in:${file}`)}
              <span className="w-full truncate pl-1.5">{basename(file)}</span>
              {isManifest ? null : dot("source", `out:${file}`)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function edgeKey(e: MapEdge): string {
  return `${e.source}->${e.target}@${e.sourceFile}->${e.targetFile}`;
}

function edgeFor(e: MapEdge, expanded: ReadonlySet<string>, bright: boolean): Edge {
  const srcOpen = expanded.has(e.source);
  const tgtOpen = expanded.has(e.target);
  const sourceHandle = srcOpen ? `out:${e.sourceFile}` : "source";
  const targetHandle = tgtOpen ? `in:${e.targetFile}` : "target";
  // Two folded nodes share one edge for the pair; an open panel keeps an edge
  // per file row so edges land on the row that matters.
  const dedupe =
    srcOpen || tgtOpen
      ? edgeKey(e)
      : `${e.source}->${e.target}`;
  return {
    id: dedupe,
    source: e.source,
    target: e.target,
    sourceHandle,
    targetHandle,
    type: "flow",
    zIndex: 1,
    style: {
      opacity: bright ? 1 : 0.06,
      transition: "opacity 160ms ease",
    },
  };
}

function MapGraphInner({ datum }: { datum: GraphDatum }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const { selection, setSelection, category, roleByPath, folded } = useWorkspace();
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const zoomBeforeToggle = useRef(1);
  const previousExpanded = useRef<ReadonlySet<string>>(new Set());
  const syncRaf = useRef<number | null>(null);

  // Scrolling inside an open panel moves its row handles; tell React Flow to
  // re-measure so edges keep landing on the right row. Coalesced to one
  // measure per frame.
  const syncNodeInternals = useCallback(
    (id: string) => {
      if (syncRaf.current !== null) cancelAnimationFrame(syncRaf.current);
      syncRaf.current = requestAnimationFrame(() => {
        syncRaf.current = null;
        updateNodeInternals(id);
      });
    },
    [updateNodeInternals],
  );

  const fileToNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of datum.nodes) {
      for (const file of node.files) map.set(file, node.id);
    }
    return map;
  }, [datum]);

  const fileOf = useCallback(
    (path: string) => fileToNode.get(path) ?? null,
    [fileToNode],
  );

  const manifestSet = useMemo(
    () => new Set(folded.manifestFiles),
    [folded.manifestFiles],
  );

  const openNode = useCallback(
    (id: string) => {
      zoomBeforeToggle.current = rf.getZoom();
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setSelection({ kind: "node", id });
    },
    [rf, setSelection],
  );

  // Closing a panel clears the selection when it belonged to that panel.
  const closeNode = useCallback(
    (id: string) => {
      zoomBeforeToggle.current = rf.getZoom();
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSelection((sel) => {
        if (!sel) return sel;
        if (sel.kind === "node" && sel.id === id) return null;
        if (sel.kind === "file" && fileOf(sel.path) === id) return null;
        return sel;
      });
    },
    [fileOf, rf, setSelection],
  );

  const selectNode = useCallback((id: string) => {
    setSelection((sel) =>
      sel && sel.kind === "node" && sel.id === id ? null : { kind: "node", id },
    );
  }, [setSelection]);

  const selectFile = useCallback((file: string) => {
    setSelection((sel) =>
      sel && sel.kind === "file" && sel.path === file ? null : { kind: "file", path: file },
    );
  }, [setSelection]);

  const { positions, sizes } = useMemo(
    () => layoutNodes(datum.nodes, datum.edges, datum.labels, expanded),
    [datum, expanded],
  );

  // Opening a folder refits the view to the new panel, and the refit may only
  // ever zoom out: the capture above is the zoom ceiling while it runs.
  useEffect(() => {
    const before = previousExpanded.current;
    const opened = [...expanded].find((id) => !before.has(id));
    previousExpanded.current = expanded;
    if (!opened) return;
    const timer = window.setTimeout(() => {
      void rf.fitView({
        nodes: [{ id: opened }],
        padding: 0.25,
        maxZoom: zoomBeforeToggle.current,
        duration: 200,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [expanded, rf]);

  // What stays at full strength: the selection, its edges, and whatever those
  // edges connect to. Everything else dims. If a category is chosen, nodes that
  // contain nothing of it also dim, and edges that would connect to them dim.
  const focus = useMemo(() => {
    if (!selection) {
      return {
        keptNodes: null as Set<string> | null,
        keptFiles: null as Set<string> | null,
        brightEdges: null as Set<string> | null,
      };
    }
    const brightEdges = new Set<string>();
    if (selection.kind === "node") {
      const keptNodes = new Set<string>([selection.id]);
      for (const e of datum.edges) {
        if (e.source === selection.id || e.target === selection.id) {
          keptNodes.add(e.source);
          keptNodes.add(e.target);
          brightEdges.add(edgeKey(e));
        }
      }
      return { keptNodes, keptFiles: null, brightEdges };
    }
    const keptFiles = new Set<string>([selection.path]);
    const keptNodes = new Set<string>([fileToNode.get(selection.path) ?? ""]);
    for (const e of datum.edges) {
      if (e.sourceFile === selection.path) {
        brightEdges.add(edgeKey(e));
        keptFiles.add(e.targetFile);
        const owner = fileToNode.get(e.targetFile);
        if (owner) keptNodes.add(owner);
      } else if (e.targetFile === selection.path) {
        brightEdges.add(edgeKey(e));
        keptFiles.add(e.sourceFile);
        const owner = fileToNode.get(e.sourceFile);
        if (owner) keptNodes.add(owner);
      }
    }
    keptNodes.delete("");
    return { keptNodes, keptFiles, brightEdges };
  }, [selection, datum, fileToNode]);

  const categoryMatch = useMemo(
    () => (category === null ? null : matchCategory(datum.nodes, roleByPath, category)),
    [datum.nodes, category, roleByPath],
  );

  const rfNodes = useMemo<FolderNode[]>(
    () =>
      datum.nodes.map((node) => {
        const isOpen = expanded.has(node.id);
        const size = sizes.get(node.id)!;
        const position = positions.get(node.id)!;
        const focusDim = focus.keptNodes !== null && !focus.keptNodes.has(node.id);
        const catDim =
          categoryMatch !== null && !categoryMatch.nodeHasMatch.get(node.id);
        const dimmed = focusDim || catDim;
        const matchedSet =
          categoryMatch !== null
            ? categoryMatch.nodeMatched.get(node.id) ?? null
            : null;
        return {
          id: node.id,
          type: "folder",
          position,
          zIndex: 5,
          data: {
            label: datum.labels[node.id],
            fileCount: node.files.length,
            files: node.files,
            fanIn: node.fanIn,
            fanOut: node.fanOut,
            expanded: isOpen,
            size,
            onOpen: openNode,
            onClose: closeNode,
            onSelectNode: selectNode,
            onSelectFile: selectFile,
            onScroll: syncNodeInternals,
            selected: selection?.kind === "node" && selection.id === node.id,
            selectedFile: selection?.kind === "file" ? selection.path : null,
            dimmed,
            rowDim: focus.keptFiles,
            manifest: manifestSet,
            matched: matchedSet,
          },
        };
      }),
    [
      datum,
      expanded,
      positions,
      sizes,
      openNode,
      closeNode,
      selectNode,
      selectFile,
      syncNodeInternals,
      selection,
      focus,
      categoryMatch,
      manifestSet,
    ],
  );

  const rfEdges = useMemo(() => {
    const seen = new Set<string>();
    const edges: Edge[] = [];
    for (const e of datum.edges) {
      const dedupe =
        expanded.has(e.source) || expanded.has(e.target)
          ? edgeKey(e)
          : `${e.source}->${e.target}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const focusOk =
        focus.brightEdges === null || focus.brightEdges.has(edgeKey(e));
      // With a kind chosen, an edge stays lit only when both ends hold a file
      // of that kind — otherwise the dimmed nodes would still be joined.
      const categoryOk =
        categoryMatch === null ||
        (categoryMatch.nodeHasMatch.get(e.source) === true &&
          categoryMatch.nodeHasMatch.get(e.target) === true);
      edges.push(edgeFor(e, expanded, focusOk && categoryOk));
    }
    return edges;
  }, [datum, expanded, focus, categoryMatch]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.15}
      maxZoom={1.75}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable={false}
      panOnScroll
      zoomOnDoubleClick={false}
      deleteKeyCode={null}
      onPaneClick={() => setSelection(null)}
      className="bg-surface"
    >
      <Background color="var(--color-border)" gap={26} size={1.5} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}

export function MapGraph({ datum }: { datum: GraphDatum }) {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <MapGraphInner datum={datum} />
      </ReactFlowProvider>
    </div>
  );
}