/*
 * The four capability visuals. Each one draws the behaviour it sits next to,
 * and each is a different kind of diagram rather than the same card four times.
 * All are decorative support for the adjacent copy, so they are aria-hidden and
 * the copy carries the meaning.
 */

/* 1. Parsed dependencies: a file with imports in and out, and the coverage
   buckets every import lands in (resolved / outside / excluded / failed). */
export function ParsedEdgesVisual() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface p-5">
      <svg
        viewBox="0 0 320 168"
        aria-hidden
        className="block h-auto w-full"
      >
        <defs>
          <marker id="cap-arrow-in" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--incoming)" />
          </marker>
          <marker id="cap-arrow-out" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--outgoing)" />
          </marker>
        </defs>

        {/* left: importers (incoming) */}
        {[20, 68, 116].map((y, i) => (
          <g key={`in-${i}`}>
            <rect x="8" y={y} width="86" height="22" rx="5" fill="var(--raised)" stroke="var(--border)" />
            <text x="18" y={y + 15} fontFamily="var(--font-geist-mono)" fontSize="9.5" fill="var(--muted)">
              importer-{i + 1}.ts
            </text>
            <path
              d={`M 94 ${y + 11} C 118 ${y + 11} 118 84 132 84`}
              fill="none"
              stroke="var(--incoming)"
              strokeWidth="1.5"
              markerEnd="url(#cap-arrow-in)"
            />
          </g>
        ))}

        {/* centre: the subject */}
        <rect x="132" y="66" width="104" height="36" rx="6" fill="var(--surface)" stroke="var(--accent)" />
        <circle cx="146" cy="84" r="3" fill="var(--file-ts)" />
        <text x="156" y="88" fontFamily="var(--font-geist-mono)" fontSize="10" fill="var(--text)">
          lib/env.ts
        </text>

        {/* right: its imports (outgoing) */}
        {[52, 84, 116].map((y, i) => (
          <g key={`out-${i}`}>
            <path
              d={`M 236 84 C 254 84 254 ${y + 11} 272 ${y + 11}`}
              fill="none"
              stroke="var(--outgoing)"
              strokeWidth="1.5"
              markerEnd="url(#cap-arrow-out)"
            />
            <rect x="272" y={y} width="40" height="22" rx="5" fill="var(--raised)" stroke="var(--border)" />
            <text x="281" y={y + 15} fontFamily="var(--font-geist-mono)" fontSize="9.5" fill="var(--muted)">
              dep-{i + 1}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4 font-mono text-[10px]">
        <span className="rounded border border-border px-2 py-0.5 text-text">
          resolved
        </span>
        <span className="rounded border border-border px-2 py-0.5 text-muted">
          outside
        </span>
        <span className="rounded border border-border px-2 py-0.5 text-muted">
          excluded
        </span>
        <span className="rounded border border-border px-2 py-0.5 text-muted">
          failed
        </span>
      </div>
    </div>
  );
}

/* 2. Blast radius / dependency chain: two walks out from one file. */
export function RadiusVisual() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface p-5">
      <svg viewBox="0 0 320 172" aria-hidden className="block h-auto w-full">
        <defs>
          <marker id="rad-arrow-in" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--incoming)" />
          </marker>
          <marker id="rad-arrow-out" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--outgoing)" />
          </marker>
        </defs>

        <circle cx="160" cy="86" r="52" fill="none" stroke="var(--border)" strokeDasharray="3 4" />
        <circle cx="160" cy="86" r="82" fill="none" stroke="var(--border)" strokeDasharray="3 4" />

        {[
          { x: 108, y: 34 },
          { x: 212, y: 34 },
          { x: 160, y: 150 },
        ].map((p, i) => (
          <g key={`in-${i}`}>
            <path
              d={`M ${p.x + 16} ${p.y + 10} C 150 70 150 70 160 86`}
              fill="none"
              stroke="var(--incoming)"
              strokeWidth="1.5"
              markerEnd="url(#rad-arrow-in)"
            />
            <rect x={p.x} y={p.y} width="34" height="20" rx="5" fill="var(--raised)" stroke="var(--border)" />
          </g>
        ))}

        {[
          { x: 40, y: 78 },
          { x: 246, y: 78 },
        ].map((p, i) => (
          <g key={`out-${i}`}>
            <path
              d={`M 160 86 C 200 86 ${p.x + 17} ${p.y + 10} ${p.x + 17} ${p.y + 10}`}
              fill="none"
              stroke="var(--outgoing)"
              strokeWidth="1.5"
              markerEnd="url(#rad-arrow-out)"
            />
            <rect x={p.x} y={p.y} width="34" height="20" rx="5" fill="var(--raised)" stroke="var(--border)" />
          </g>
        ))}

        <rect x="126" y="73" width="68" height="26" rx="6" fill="var(--surface)" stroke="var(--accent)" />
        <text x="135" y="90" fontFamily="var(--font-geist-mono)" fontSize="9.5" fill="var(--text)">
          selected
        </text>
      </svg>

      <p className="mt-4 border-t border-border pt-4 font-mono text-[10px] text-muted">
        2 hops · arithmetic over the edge list · no request
      </p>
    </div>
  );
}

/* 3. Grounded explanations: neighbours feed the paragraph. */
export function ExplanationVisual() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface p-5">
      <ul className="flex flex-col gap-2">
        {["app/layout.tsx", "pipeline/load.ts", "api/analyses/route.ts"].map(
          (f) => (
            <li
              key={f}
              className="flex items-center gap-2 font-mono text-[11px] text-muted"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-incoming" />
              {f}
            </li>
          )
        )}
      </ul>
      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono text-[10px] text-muted">
          real neighbours
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <p className="text-[13px] leading-relaxed text-text">
        &ldquo;A shared contract for environment values. It is read at the edge
        of the app and again when a run is saved — so a change here travels to
        everything that boots.&rdquo;
      </p>
      <p className="mt-3 font-mono text-[10px] text-muted">
        cached · restored across loads
      </p>
    </div>
  );
}

/* 4. Ask: the lookup printed before the answer. */
export function AskVisual() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface p-5 font-mono text-[11px]">
      <div className="flex items-center gap-2 text-muted">
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px]">
          tool
        </span>
        <span className="text-accent">direct_neighbours</span>
        <span className="text-muted">{'("lib/env.ts", incoming)'}</span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-muted">
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px]">
          tool
        </span>
        <span className="text-accent">search_files</span>
        <span className="text-muted">{'("env")'}</span>
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <p className="font-mono text-[10px] text-muted">answer</p>
        <p className="mt-1 text-[12px] leading-relaxed text-text">
          Three files read from it. The edges are the parser&rsquo;s; only this
          sentence is the model&rsquo;s.
        </p>
      </div>
    </div>
  );
}
