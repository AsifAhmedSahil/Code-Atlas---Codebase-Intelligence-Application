import { AuthCta } from "./auth-cta";
import { CTA_PRIMARY } from "./styles";

/*
 * The close. It echoes the hero's measured grid so the page opens and shuts on
 * the same idea, and offers the one action that exists — resolved by sign-in
 * state. Nothing else: no demo booking, no pricing, no request-for-access.
 */
export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-border bg-raised">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(100% 120% at 50% 0%, black 0%, transparent 72%)",
          WebkitMaskImage:
            "radial-gradient(100% 120% at 50% 0%, black 0%, transparent 72%)",
        }}
      />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col items-start gap-8 px-6 py-24 sm:py-28">
        <p className="font-mono text-xs text-accent">Start with a URL</p>
        <h2 className="max-w-[20ch] font-display text-3xl font-medium leading-[1.08] tracking-[-0.02em] text-text sm:text-[2.75rem]">
          Map a public repository and read its shape.
        </h2>
        <p className="max-w-[48ch] text-base leading-relaxed text-muted">
          Folders as boxes, imports as lines, and an assistant that looks
          answers up instead of guessing them.
        </p>
        <AuthCta className={CTA_PRIMARY} />
      </div>
    </section>
  );
}
