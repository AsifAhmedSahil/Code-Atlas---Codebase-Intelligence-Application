"use client";

// The client root of the workspace. It holds the one shared selection and hover,
// hands the map its datum, and renders the three settled columns. It lives
// below the server page, which does the parsing and folding once.

import type { FoldedMap } from "@/lib/map/fold";
import type { ParseResult } from "@/lib/parser/types";
import type { ReactNode } from "react";

import type { FileCategory } from "./categories";
import { DetailPane } from "./detail-pane";
import { FileRail } from "./file-rail";
import { MapCanvas } from "./map-canvas";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceShell } from "./workspace-shell";

export function WorkspaceView({
  analysisId,
  parse,
  folded,
  labels,
  categories,
  banner,
}: {
  analysisId: string;
  parse: ParseResult;
  folded: FoldedMap;
  labels: Record<string, string>;
  categories: FileCategory[];
  // Rendered above the map, inside the middle column, so a note about the map
  // reads as part of the map rather than as a page banner.
  banner?: ReactNode;
}) {
  const datum = { nodes: folded.nodes, edges: folded.edges, labels };

  return (
    <WorkspaceProvider
      analysisId={analysisId}
      parse={parse}
      folded={folded}
      labels={labels}
    >
      <WorkspaceShell
        rail={<FileRail categories={categories} total={parse.counts.parsed} />}
        canvas={
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {banner}
            <MapCanvas datum={datum} />
          </div>
        }
        detail={<DetailPane />}
      />
    </WorkspaceProvider>
  );
}
