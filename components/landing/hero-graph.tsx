/*
 * The hero's dependency graph. A tighter, more legible drawing than the full
 * product preview: three folder groups, the files inside them, and the import
 * edges that connect them. Green runs toward a file (something depends on it),
 * amber runs away from it (it depends on something) — the same two colours the
 * real canvas uses for direction, and the only place either appears.
 *
 * It is an illustration of the graph's semantics, drawn by hand, and labelled as
 * such where it is shown. It is not a screenshot.
 */

type Node = { id: string; x: number; y: number; kind: "ts" | "tsx" | "other" };
type Edge = { from: string; to: string; dir: "in" | "out" };

const NODES: Node[] = [
  { id: "app/page", x: 96, y: 52, kind: "tsx" },
  { id: "app/layout", x: 96, y: 108, kind: "tsx" },
  { id: "lib/env", x: 316, y: 80, kind: "ts" },
  { id: "lib/supabase", x: 316, y: 136, kind: "ts" },
  { id: "pipeline/load", x: 536, y: 52, kind: "ts" },
  { id: "map/walk", x: 536, y: 136, kind: "ts" },
];

const KIND_COLOR: Record<Node["kind"], string> = {
  ts: "var(--file-ts)",
  tsx: "var(--file-tsx)",
  other: "var(--file-other)",
};

/* Group frames drawn behind the nodes: { label, x, y, w, h }. */
const GROUPS = [
  { label: "app/", x: 56, y: 24, w: 120, h: 116 },
  { label: "lib/", x: 276, y: 52, w: 120, h: 116 },
  { label: "pipeline · map/", x: 496, y: 24, w: 120, h: 144 },
];

const EDGES: Edge[] = [
  { from: "app/page", to: "lib/env", dir: "out" },
  { from: "app/layout", to: "lib/env", dir: "out" },
  { from: "app/layout", to: "lib/supabase", dir: "out" },
  { from: "lib/supabase", to: "pipeline/load", dir: "in" },
  { from: "pipeline/load", to: "map/walk", dir: "in" },
];

function byId(id: string): Node {
  const node = NODES.find((n) => n.id === id);
  if (!node) throw new Error(`unknown node: ${id}`);
  return node;
}

export function HeroGraph() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-mono text-[11px] text-muted">
          owner/repo · dependency map
        </span>
        <span className="font-mono text-[10px] text-muted">illustration</span>
      </div>
      <svg
        viewBox="0 0 672 200"
        role="img"
        aria-label="Illustration of a dependency graph: three folders of files connected by import lines, green edges pointing to a file, amber edges pointing away from it."
        className="block h-auto w-full"
      >
        <rect width="672" height="200" fill="var(--surface)" />

        <defs>
          <marker
            id="hero-arrow-in"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--incoming)" />
          </marker>
          <marker
            id="hero-arrow-out"
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
          {EDGES.map((e) => {
            const a = byId(e.from);
            const b = byId(e.to);
            const color = e.dir === "out" ? "var(--outgoing)" : "var(--incoming)";
            const marker =
              e.dir === "out" ? "url(#hero-arrow-out)" : "url(#hero-arrow-in)";
            const midX = (a.x + b.x) / 2;
            return (
              <path
                key={`${e.from}-${e.to}`}
                d={`M ${a.x + 44} ${a.y + 12} C ${midX} ${a.y + 12} ${midX} ${b.y + 12} ${b.x - 8} ${b.y + 12}`}
                stroke={color}
                markerEnd={marker}
              />
            );
          })}
        </g>

        {NODES.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width="140"
              height="24"
              rx="5"
              fill="var(--surface)"
              stroke="var(--border)"
            />
            <circle cx={n.x + 11} cy={n.y + 12} r="3" fill={KIND_COLOR[n.kind]} />
            <text
              x={n.x + 22}
              y={n.y + 16}
              fontFamily="var(--font-geist-mono)"
              fontSize="10.5"
              fill="var(--text)"
            >
              {n.id}
            </text>
          </g>
        ))}

        <g fontFamily="var(--font-geist-mono)" fontSize="10" fill="var(--muted)">
          <circle cx="60" cy="184" r="3" fill="var(--incoming)" />
          <text x="70" y="187">incoming</text>
          <circle cx="150" cy="184" r="3" fill="var(--outgoing)" />
          <text x="160" y="187">outgoing</text>
          <circle cx="248" cy="184" r="3" fill="var(--file-tsx)" />
          <text x="258" y="187">.tsx</text>
          <circle cx="306" cy="184" r="3" fill="var(--file-ts)" />
          <text x="316" y="187">.ts</text>
        </g>
      </svg>
    </div>
  );
}
