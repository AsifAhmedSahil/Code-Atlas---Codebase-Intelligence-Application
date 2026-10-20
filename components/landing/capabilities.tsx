import type { ReactNode } from "react";

import { Section } from "./section";
import {
  AskVisual,
  ExplanationVisual,
  ParsedEdgesVisual,
  RadiusVisual,
} from "./capability-visuals";

type Capability = {
  k: string;
  title: string;
  body: string;
  visual: ReactNode;
};

const CAPABILITIES: Capability[] = [
  {
    k: "01",
    title: "Parsed dependencies, never invented",
    body: "Imports, re-exports, dynamic imports, and require calls become edges. Every import lands in one bucket — resolved, outside, excluded, or failed — and the unresolved ones are kept in full rather than hidden.",
    visual: <ParsedEdgesVisual />,
  },
  {
    k: "02",
    title: "Blast radius and dependency chain",
    body: "Select a file and see what depends on it and what it depends on, two hops out. Both are arithmetic over the edge list, so they answer instantly — no request, no spinner.",
    visual: <RadiusVisual />,
  },
  {
    k: "03",
    title: "Explanations grounded in real neighbours",
    body: "A written paragraph is built from the subject and the files that actually import it or are imported by it. It is cached, restored across page loads, and notes when the repository has moved on.",
    visual: <ExplanationVisual />,
  },
  {
    k: "04",
    title: "Ask, with the lookups shown",
    body: "Ask a structural question and watch the tool calls appear before the answer. The assistant reads the map through read-only tools and cannot decide an edge or walk the graph on its own.",
    visual: <AskVisual />,
  },
];

/*
 * Alternating rows rather than a card grid: each capability pairs its own
 * diagram with its copy, and the diagram side flips on desktop so the page does
 * not read as four identical blocks.
 */
export function Capabilities() {
  return (
    <Section
      id="capabilities"
      label="What it does"
      title="A map you can interrogate, built on facts you can check."
      width="wide"
    >
      <div className="flex flex-col gap-16 sm:gap-20">
        {CAPABILITIES.map((c, i) => {
          const flip = i % 2 === 1;
          return (
            <div
              key={c.k}
              className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14"
            >
              <div className={flip ? "lg:order-2" : ""}>{c.visual}</div>
              <div className={flip ? "lg:order-1" : ""}>
                <span className="font-mono text-xs text-accent">{c.k}</span>
                <h3 className="mt-3 max-w-[24ch] font-display text-xl font-medium leading-tight tracking-[-0.01em] text-text sm:text-2xl">
                  {c.title}
                </h3>
                <p className="mt-4 max-w-[46ch] text-sm leading-relaxed text-muted sm:text-base">
                  {c.body}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
