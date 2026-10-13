"use client";

// The client root of the workspace. It holds the one shared selection and hover,
// hands the map its datum, and renders the three settled columns. It lives
// below the server page, which does the parsing and folding once.

import type { FoldedMap } from "@/lib/map/fold";
import type { ParseResult } from "@/lib/parser/types";

import type { FileCategory } from "./categories";
import { DetailPane } from "./detail-pane";
import { FileRail } from "./file-rail";
import { MapCanvas } from "./map-canvas";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceShell } from "./workspace-shell";

export function WorkspaceView({
  parse,
  folded,
  labels,
  categories,
}: {
  parse: ParseResult;
  folded: FoldedMap;
  labels: Record<string, string>;
  categories: FileCategory[];
}) {
  const datum = { nodes: folded.nodes, edges: folded.edges, labels };

  return (
    <WorkspaceProvider parse={parse} folded={folded} labels={labels}>
      <WorkspaceShell
        rail={<FileRail categories={categories} total={parse.counts.parsed} />}
        canvas={<MapCanvas datum={datum} />}
        detail={<DetailPane />}
      />
    </WorkspaceProvider>
  );
}
