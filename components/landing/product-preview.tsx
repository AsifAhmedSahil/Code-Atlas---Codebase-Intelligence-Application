/*
 * A hybrid product preview: the shape of the real workspace (left file-kind
 * rail, centre graph, right detail pane) built as ordinary layout rather than
 * one large SVG, so it stays legible and reflows on small screens. The graph
 * inside it is hand-drawn from the same semantics as the canvas — folder
 * groups, file nodes, green incoming / amber outgoing edges.
 *
 * This is an illustration, not a screenshot of a running analysis, and it is
 * labelled as one. Its filenames and edges are illustrative, not a snapshot of
 * a particular repository.
 */

const KINDS = [
  { label: ".ts", color: "var(--file-ts)" },
  { label: ".tsx", color: "var(--file-tsx)" },
  { label: ".js", color: "var(--file-js)" },
  { label: ".d.ts", color: "var(--file-dts)" },
  { label: "other", color: "var(--file-other)" },
];

type Group = { label: string; x: number; y: number; w: number; h: number };
type FileNode = {
  id: string;
  x: number;
  y: number;
  color: string;
  dim?: boolean;
};
type Edge = { d: string; dir: "in" | "out" };

const GROUPS: Group[] = [
  { label: "app/", x: 16, y: 16, w: 150, h: 128 },
  { label: "lib/", x: 196, y: 40, w: 150, h: 128 },
  { label: "components/", x: 376, y: 16, w: 150, h: 128 },
  { label: "agent/", x: 196, y: 188, w: 150, h: 84 },
];

const NODES: FileNode[] = [
  { id: "layout.tsx", x: 28, y: 44, color: "var(--file-tsx)" },
  { id: "page.tsx", x: 28, y: 72, color: "var(--file-tsx)" },
  { id: "route.ts", x: 28, y: 100, color: "var(--file-ts)", dim: true },
  { id: "env.ts", x: 208, y: 68, color: "var(--file-ts)" },
  { id: "supabase.ts", x: 208, y: 96, color: "var(--file-ts)" },
  { id: "walk.ts", x: 208, y: 124, color: "var(--file-ts)", dim: true },
  { id: "map-graph.tsx", x: 388, y: 44, color: "var(--file-tsx)" },
  { id: "detail-pane.tsx", x: 388, y: 72, color: "var(--file-tsx)" },
  { id: "tools.ts", x: 208, y: 212, color: "var(--file-ts)" },
];

const EDGES: Edge[] = [
  { d: "M 128 56 C 168 56 168 80 208 80", dir: "out" },
  { d: "M 128 84 C 168 84 168 108 208 108", dir: "out" },
  { d: "M 128 112 C 168 112 168 220 208 224", dir: "out" },
  { d: "M 348 80 C 368 80 368 56 388 56", dir: "in" },
  { d: "M 348 108 C 368 108 368 84 388 84", dir: "in" },
];

export function ProductPreview() {
  return (
    <figure className="not-prose">
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        {/* workspace top bar */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-display text-[12px] font-medium text-text">
              example/repository
            </span>
            <span className="hidden truncate font-mono text-[11px] text-muted sm:inline">
              github.com/example/repository
            </span>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-muted">
            illustration
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[132px_minmax(0,1fr)_230px]">
          {/* left rail: file kinds, greyscale chrome with kind dots */}
          <div className="hidden border-r border-border px-3 py-4 md:block">
            <p className="mb-3 font-mono text-[10px] text-muted">Kinds</p>
            <ul className="flex flex-col gap-2">
              {KINDS.map((k) => (
                <li
                  key={k.label}
                  className="flex items-center justify-between font-mono text-[11px]"
                >
                  <span className="flex items-center gap-2 text-text">
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ background: k.color }}
                    />
                    {k.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* centre: the graph */}
          <div className="bg-raised/40 p-3">
            <svg
              viewBox="0 0 540 292"
              role="img"
              aria-label="Illustration of the dependency graph: folders shown as groups of files, connected by import lines. Green lines point to files that are depended on; amber lines point away."
              className="block h-auto w-full"
            >
              <defs>
                <marker
                  id="pv-arrow-in"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--incoming)" />
                </marker>
                <marker
                  id="pv-arrow-out"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--outgoing)" />
                </marker>
              </defs>

              {GROUPS.map((g) => (
                <g key={g.label}>
                  <rect
                    x={g.x}
                    y={g.y}
                    width={g.w}
                    height={g.h}
                    rx="8"
                    fill="var(--raised)"
                    stroke="var(--border)"
                  />
                  <text
                    x={g.x + 10}
                    y={g.y + 16}
                    fontFamily="var(--font-geist-mono)"
                    fontSize="10"
                    fill="var(--muted)"
                  >
                    {g.label}
                  </text>
                </g>
              ))}

              <g fill="none" strokeWidth="1.5">
                {EDGES.map((e, i) => (
                  <path
                    key={i}
                    d={e.d}
                    stroke={
                      e.dir === "out" ? "var(--outgoing)" : "var(--incoming)"
                    }
                    markerEnd={
                      e.dir === "out"
                        ? "url(#pv-arrow-out)"
                        : "url(#pv-arrow-in)"
                    }
                  />
                ))}
              </g>

              {NODES.map((n) => (
                <g key={n.id} opacity={n.dim ? 0.55 : 1}>
                  <circle cx={n.x + 6} cy={n.y + 8} r="3" fill={n.color} />
                  <text
                    x={n.x + 14}
                    y={n.y + 11}
                    fontFamily="var(--font-geist-mono)"
                    fontSize="10"
                    fill="var(--text)"
                  >
                    {n.id}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* right pane: Structure with blast radius (arithmetic, instant) */}
          <div className="border-t border-border px-4 py-4 md:border-l md:border-t-0">
            <div className="mb-3 flex items-center gap-3 font-mono text-[10px]">
              <span className="text-text">Structure</span>
              <span className="text-muted">Routes</span>
              <span className="text-muted">Explain</span>
            </div>
            <p className="font-mono text-[11px] text-text">lib/env.ts</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Selected. What depends on it, and what it depends on, two hops out.
            </p>

            <div className="mt-4">
              <p className="mb-2 font-mono text-[10px] text-muted">
                Blast radius
              </p>
              <ul className="flex flex-col gap-1.5 font-mono text-[11px]">
                <li className="flex items-center gap-2 text-text">
                  <span className="h-1.5 w-1.5 rounded-full bg-incoming" />
                  example/importer.ts
                </li>
                <li className="flex items-center gap-2 text-text">
                  <span className="h-1.5 w-1.5 rounded-full bg-incoming" />
                  example/consumer.ts
                </li>
              </ul>
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <p className="font-mono text-[10px] text-muted">
                Incoming · Outgoing
              </p>
            </div>
          </div>
        </div>
      </div>

      <figcaption className="mx-auto mt-3 max-w-2xl text-center text-xs text-muted">
        An illustrative workspace view, not a repository analysis. In a real
        map, each file and line comes from parsing the repository.
      </figcaption>
    </figure>
  );
}
