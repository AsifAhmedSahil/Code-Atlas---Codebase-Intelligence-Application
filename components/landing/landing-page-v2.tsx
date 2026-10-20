import Link from "next/link";

import { AuthCta } from "./auth-cta";
import { MarketingFooter } from "./marketing-footer";
import { MarketingNav } from "./marketing-nav";

const STAGES = [
  ["Fetch", "Read a public GitHub repository."],
  ["Unpack", "Expand the archive and find the project root."],
  ["Parse", "Resolve imports into graph edges."],
  ["Classify", "Label files the parser cannot identify."],
  ["Store", "Save the map for the workspace."],
];

const MAP_NODES = [
  { id: "entry.tsx", x: 52, y: 54, kind: "tsx" },
  { id: "routes.ts", x: 52, y: 132, kind: "ts" },
  { id: "graph.ts", x: 258, y: 94, kind: "ts" },
  { id: "map-view.tsx", x: 464, y: 54, kind: "tsx" },
  { id: "ask-tools.ts", x: 464, y: 132, kind: "ts" },
] as const;

const MAP_EDGES = [
  ["entry.tsx", "graph.ts", "in"],
  ["routes.ts", "graph.ts", "in"],
  ["graph.ts", "map-view.tsx", "out"],
  ["graph.ts", "ask-tools.ts", "out"],
] as const;

function ProductMap() {
  const nodeById = new Map(MAP_NODES.map((node) => [node.id, node]));

  return (
    <section className="atlas-product" aria-labelledby="map-preview-title">
      <div className="atlas-product-frame">
        <div className="atlas-window-bar">
          <div className="atlas-window-brand">
            <span className="atlas-window-mark" aria-hidden="true">R</span>
            <span id="map-preview-title">example / repository</span>
          </div>
          <div className="atlas-window-meta">
            <span className="atlas-live-dot" /> Illustrative map
          </div>
          <div className="atlas-window-controls" aria-hidden="true">
            <span /> <span /> <span />
          </div>
        </div>

        <div className="atlas-workspace">
          <aside className="atlas-rail" aria-label="Workspace sections">
            <p className="atlas-rail-label">Explore</p>
            <div className="atlas-rail-item atlas-rail-active"><span>⌘</span> Map</div>
            <div className="atlas-rail-item"><span>↗</span> Routes</div>
            <div className="atlas-rail-item"><span>✳</span> Ask
            </div>
            <div className="atlas-rail-divider" />
            <p className="atlas-rail-label">File kinds</p>
            <div className="atlas-kind"><i className="kind-tsx" /> TypeScript JSX</div>
            <div className="atlas-kind"><i className="kind-ts" /> TypeScript</div>
            <div className="atlas-kind"><i className="kind-js" /> JavaScript</div>
            <div className="atlas-rail-foot">Parser coverage<br /><span>See unresolved imports</span></div>
          </aside>

          <div className="atlas-canvas-wrap">
            <div className="atlas-canvas-topline">
              <span>Dependency map</span>
              <span className="atlas-canvas-path">example / repository / src</span>
              <span className="atlas-zoom">− &nbsp; 100% &nbsp; +</span>
            </div>
            <div className="atlas-map-scroll" role="region" aria-label="Dependency graph illustration" tabIndex={0}>
            <svg
              className="atlas-map-svg"
              viewBox="0 0 660 240"
              role="img"
              aria-label="Illustrative dependency graph showing five files connected by directional import edges."
            >
              <defs>
                <pattern id="atlas-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                  <path d="M 24 0 L 0 0 0 24" fill="none" className="atlas-grid-line" />
                </pattern>
                <marker id="atlas-arrow-out" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" className="atlas-arrow-amber" />
                </marker>
                <marker id="atlas-arrow-in" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" className="atlas-arrow-green" />
                </marker>
                <filter id="atlas-glow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <rect width="660" height="240" fill="url(#atlas-grid)" />
              <g className="atlas-group">
                <rect x="26" y="26" width="154" height="176" rx="9" />
                <text x="40" y="46">src / entry</text>
              </g>
              <g className="atlas-group atlas-group-focus">
                <rect x="232" y="62" width="154" height="104" rx="9" />
                <text x="246" y="82">src / core</text>
              </g>
              <g className="atlas-group">
                <rect x="438" y="26" width="190" height="176" rx="9" />
                <text x="452" y="46">src / surface</text>
              </g>
              <g fill="none" strokeWidth="2">
                {MAP_EDGES.map(([from, to, direction]) => {
                  const a = nodeById.get(from)!;
                  const b = nodeById.get(to)!;
                  const x1 = a.x + 128;
                  const x2 = b.x - 8;
                  const mid = (x1 + x2) / 2;
                  return (
                    <path
                      key={`${from}-${to}`}
                      d={`M ${x1} ${a.y + 17} C ${mid} ${a.y + 17}, ${mid} ${b.y + 17}, ${x2} ${b.y + 17}`}
                      className={direction === "out" ? "atlas-edge-out" : "atlas-edge-in"}
                      markerEnd={direction === "out" ? "url(#atlas-arrow-out)" : "url(#atlas-arrow-in)"}
                    />
                  );
                })}
              </g>
              {MAP_NODES.map((node) => (
                <g key={node.id} className={`atlas-node atlas-node-${node.kind}${node.id === "graph.ts" ? " atlas-node-focus" : ""}`}>
                  <rect x={node.x} y={node.y} width="136" height="34" rx="7" />
                  <circle cx={node.x + 15} cy={node.y + 17} r="4" />
                  <text x={node.x + 27} y={node.y + 21}>{node.id}</text>
                </g>
              ))}
              <g className="atlas-map-legend">
                <circle cx="42" cy="222" r="3" className="atlas-legend-green" />
                <text x="52" y="225">Depends on this</text>
                <circle cx="180" cy="222" r="3" className="atlas-legend-amber" />
                <text x="190" y="225">This depends on</text>
                <text x="556" y="225">2 hops max</text>
              </g>
            </svg>
            </div>
            <div className="atlas-canvas-caption"><span>01</span> The highlighted file’s resolved neighbours and import paths appear here.</div>
          </div>

          <aside className="atlas-inspector" aria-label="Selected file details">
            <div className="atlas-inspector-head"><span>File details</span><span>⋯</span></div>
            <p className="atlas-inspector-label">Selected file</p>
            <h3>src / core / graph.ts</h3>
            <p className="atlas-inspector-copy">A file’s connections come from imports the parser resolved in source.</p>
            <div className="atlas-inspector-rule" />
            <p className="atlas-inspector-label">Explore neighbours</p>
            <div className="atlas-neighbour"><span className="atlas-neighbour-dot atlas-dot-green" /><span>Depends on this</span><b>↖</b></div>
            <div className="atlas-neighbour"><span className="atlas-neighbour-dot atlas-dot-amber" /><span>This depends on</span><b>↗</b></div>
            <div className="atlas-inspector-note">Paths shown here are examples, not analysis results.</div>
          </aside>
        </div>
      </div>
      <div className="atlas-product-caption"><span>THE MAP IS THE PRODUCT</span><span>Edges are resolved from code. Unresolved imports stay visible.</span></div>
    </section>
  );
}

function AskDemo() {
  return (
    <div className="atlas-ask-demo">
      <div className="atlas-ask-question"><span className="atlas-ask-icon">?</span><div><small>STRUCTURAL QUESTION</small><p>What depends on <code>lib/env.ts</code>?</p></div></div>
      <div className="atlas-trace-label"><span>LOOKUPS FROM THE MAP</span><span className="atlas-trace-line" /></div>
      <div className="atlas-tool-row"><span className="atlas-tool-icon">⌕</span><div><small>direct_neighbours</small><code>(&quot;lib/env.ts&quot;, incoming)</code></div><span className="atlas-tool-ok">READ</span></div>
      <div className="atlas-tool-row"><span className="atlas-tool-icon">⌕</span><div><small>search_files</small><code>(&quot;env&quot;)</code></div><span className="atlas-tool-ok">READ</span></div>
      <div className="atlas-answer"><small>ANSWER · GROUNDED IN THE LOOKUPS ABOVE</small><p>Three files read from it: <code>instrumentation.ts</code> and the server and client Supabase modules. Those links come from parsed imports; the assistant only puts the result into words.</p></div>
    </div>
  );
}

export function LandingPageV2() {
  return (
    <div className="atlas-page">
      <MarketingNav />
      <main id="main">
        <section className="atlas-hero">
          <div className="atlas-contours" aria-hidden="true" />
          <div className="atlas-hero-inner">
            <div className="atlas-kicker"><span className="atlas-kicker-mark">⌖</span> CODEBASE INTELLIGENCE, DRAWN FROM SOURCE</div>
            <h1>See how the code connects.</h1>
            <div className="atlas-hero-bottom">
              <p>Get your bearings in an unfamiliar codebase. Explore how files connect, see what a change may affect, get file and folder explanations, and ask questions grounded in the repository.</p>
              <div className="atlas-hero-actions">
                <AuthCta className="atlas-button atlas-button-primary" />
                <Link href="#how-it-works" className="atlas-text-link">How it works <span aria-hidden="true">↓</span></Link>
              </div>
            </div>
            <div className="atlas-scope-line"><span>PUBLIC GITHUB REPOSITORIES</span><i /> <span>TYPESCRIPT + JAVASCRIPT</span><i /> <span>PARSED, NOT GUESSED</span></div>
          </div>
        </section>

        <div className="atlas-showcase-wrap"><ProductMap /></div>

        <section className="atlas-principles" aria-labelledby="principles-heading">
          <div className="atlas-section-heading">
            <span className="atlas-section-index">WHY REPOSCOPE</span>
            <h2 id="principles-heading">Get oriented.<br /><em>Then change with context.</em></h2>
            <p>Understand the shape of an unfamiliar project before you edit it: what each part does, how it connects, and what may be affected.</p>
          </div>
          <div className="atlas-principle-grid">
            <article className="atlas-principle">
              <span className="atlas-principle-glyph atlas-glyph-parse" aria-hidden="true">⌘</span>
              <span className="atlas-principle-index">01 / GET THE LAY OF THE LAND</span>
              <h3>See how the project fits together</h3>
              <p>Explore a visual map of files and resolved imports. Expand folders, inspect file roles, and follow dependencies in either direction.</p>
            </article>
            <article className="atlas-principle">
              <span className="atlas-principle-glyph atlas-glyph-walk" aria-hidden="true">↗</span>
              <span className="atlas-principle-index">02 / CHANGE WITH CONTEXT</span>
              <h3>See what a change could touch</h3>
              <p>Trace dependents, dependency chains, and nearby blast radius before editing a file. Inspect routes where the parser can identify them.</p>
            </article>
            <article className="atlas-principle">
              <span className="atlas-principle-glyph atlas-glyph-ask" aria-hidden="true">?</span>
              <span className="atlas-principle-index">03 / UNDERSTAND ANY PART</span>
              <h3>Get a file or folder explained</h3>
              <p>Choose a file or folder for an explanation based on its code and actual connections to the rest of the repository.</p>
            </article>
            <article className="atlas-principle">
              <span className="atlas-principle-glyph atlas-glyph-ask" aria-hidden="true">?</span>
              <span className="atlas-principle-index">04 / ASK WITH EVIDENCE</span>
              <h3>Ask questions about the repo</h3>
              <p>Get answers from parsed files, imports, roles, and routes. See the lookups behind each response; unresolved links stay visible.</p>
            </article>
          </div>
          <p className="atlas-capability-note"><span>ALSO INCLUDED</span> Route tables where paths can be recovered · Import coverage with unresolved links called out · Shared organization workspaces</p>
        </section>

        <section className="atlas-ask-section" id="ask">
          <div className="atlas-ask-intro">
            <span className="atlas-section-index">THE ASSISTANT, WITH RECEIPTS</span>
            <h2>First the lookup.<br />Then the explanation.</h2>
            <p>Ask about dependencies, file roles, or routes. RepoScope retrieves relevant facts from the parsed graph first, then explains what those facts mean. Scope a question to one selected file or ask across the repository.</p>
            <Link href="#how-it-works" className="atlas-text-link">See how a map is made <span aria-hidden="true">↓</span></Link>
          </div>
          <AskDemo />
        </section>

        <section className="atlas-process" id="how-it-works">
          <div className="atlas-process-heading"><span className="atlas-section-index">FROM URL TO MAP</span><h2>Five steps. One source of truth.</h2></div>
          <ol className="atlas-stage-list">
            {STAGES.map(([name, detail], index) => (
              <li key={name}>
                <span className="atlas-stage-number">{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{name}</h3><p>{detail}</p></div>
                {index < STAGES.length - 1 ? <span className="atlas-stage-connector" aria-hidden="true">→</span> : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="atlas-boundary-strip">
          <div><span className="atlas-section-index">A SHARED MAP FOR YOUR TEAM</span><p>Keep repository analyses in an organization workspace and invite teammates to explore the same structure and explanations. RepoScope currently maps public TypeScript and JavaScript GitHub repositories, and shows where import coverage is incomplete.</p></div>
          <AuthCta
            className="atlas-button atlas-button-primary"
            signedInLabel="Start a new map"
            signedOutLabel="Start mapping"
          />
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
