import Link from "next/link";

import { AuthCta } from "./auth-cta";
import { HeroGraph } from "./hero-graph";
import { CTA_PRIMARY, CTA_SECONDARY } from "./styles";

/*
 * The hero: copy on the left, the graph on the right, and the graph reaches
 * wider than the copy column on large screens so the composition is asymmetric
 * rather than two equal halves. On narrow screens the copy comes first and the
 * graph follows, full width.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* A faint measured grid, drawn in borders, to set the cartographic tone
          without a gradient or an image. Decorative, so aria-hidden. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(120% 90% at 75% 0%, black 0%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(120% 90% at 75% 0%, black 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-6xl px-6 pb-20 pt-20 sm:pb-28 sm:pt-28">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-raised px-3 py-1 font-mono text-[11px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Parsed, not guessed
            </p>
            <h1 className="max-w-[15ch] font-display text-[2.5rem] font-medium leading-[1.04] tracking-[-0.025em] text-text sm:text-[3.5rem]">
              See how the code connects.
            </h1>
            <p className="mt-6 max-w-[52ch] text-base leading-relaxed text-muted sm:text-lg">
              Paste a public TypeScript or JavaScript repository and get an
              interactive dependency map. Every box and every line comes from
              really parsing the code — the assistant may explain the map and
              look facts up in it, but it never invents a relationship.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <AuthCta className={CTA_PRIMARY} />
              <Link href="#how-it-works" className={CTA_SECONDARY}>
                See how it works
              </Link>
            </div>
          </div>

          <div className="lg:-mr-[6%]">
            <HeroGraph />
          </div>
        </div>
      </div>
    </section>
  );
}
