import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { countCategories } from "@/components/workspace/categories";
import { DetailPane } from "@/components/workspace/detail-pane";
import { FileRail } from "@/components/workspace/file-rail";
import { MapCanvas } from "@/components/workspace/map-canvas";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { foldMap } from "@/lib/map/fold";
import { resolveNodeLabels } from "@/lib/map/labels";
import { getPreviewParse } from "@/lib/preview";

/*
 * The preview renders a checked-in parse of a real repository through the real
 * interface, with no account, database or network involved. It exists so the
 * canvas can be built against something worth looking at, and it goes away once
 * analyses are stored properly.
 */
export default function PreviewPage() {
  const result = getPreviewParse();
  const categories = countCategories(result.files);
  const folded = foldMap(result);
  const labels = resolveNodeLabels(folded.nodes, result.root);
  const datum = {
    nodes: folded.nodes,
    edges: folded.edges,
    labels: Object.fromEntries(labels),
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-raised px-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="font-display text-[13px] font-medium tracking-[-0.01em] text-text">
            Cartograph
          </span>
          <span className="truncate font-mono text-[11px] text-muted">
            preview · {result.root} · {result.counts.parsed} files ·{" "}
            {result.edges.length} edges · {folded.nodes.length} modules
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <Link
            href="/sign-in"
            className="text-[12px] text-accent hover:underline"
          >
            Sign in
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <WorkspaceShell
        rail={
          <FileRail categories={categories} total={result.counts.parsed} />
        }
        canvas={<MapCanvas datum={datum} />}
        detail={<DetailPane />}
      />
    </div>
  );
}