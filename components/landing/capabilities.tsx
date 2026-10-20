import type { ReactNode } from "react";

import { Section } from "./section";
import { ParsedEdgesVisual, RadiusVisual } from "./capability-visuals";

type Capability = {
  k: string;
  title: string;
  body: string;
  visual: ReactNode;
};

const CAPABILITIES: Capability[] = [
  {
    k: "The graph",
    title: "Every line has a source in the code",
    body: "Imports become directional edges when the parser can resolve them. Unresolved imports stay visible with their classification, so gaps in coverage are part of the map too.",
    visual: <ParsedEdgesVisual />,
  },
  {
    k: "Explore",
    title: "Follow impact in either direction",
    body: "Select a file to see what depends on it and what it depends on, up to two hops out. The workspace also shows routes, explanations, and parser coverage alongside the graph.",
    visual: <RadiusVisual />,
  },
];

/*
 * Alternating rows rather than a card grid: each capability pairs its own
 * diagram with its copy. The graph and exploration get one focused
 * illustration each; the Ask flow is shown separately below.
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
