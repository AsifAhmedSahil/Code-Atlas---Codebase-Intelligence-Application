import type { ReactNode } from "react";

/*
 * The frame every section shares, so the page reads as one system rather than
 * a stack of cards. Three deliberate choices:
 *
 * - A hairline rule across the top marks the boundary between sections without
 *   putting each one in a box.
 * - The label is sentence case mono, not a tracked-out all-caps eyebrow — the
 *   label is a signpost, not decoration.
 * - The title carries a measure limit so lines stay readable on wide screens.
 *
 * `width` picks the column the content sits in. Editorial sections are narrow
 * enough to read; technical sections get the wider column a diagram needs.
 */
export function Section({
  id,
  label,
  title,
  intro,
  children,
  width = "editorial",
  className = "",
}: {
  id?: string;
  label?: string;
  title?: string;
  intro?: ReactNode;
  children: ReactNode;
  width?: "editorial" | "wide";
  className?: string;
}) {
  const max = width === "wide" ? "max-w-6xl" : "max-w-5xl";
  return (
    <section id={id} className={`border-t border-border ${className}`}>
      <div className={`mx-auto w-full ${max} px-6 py-20 sm:py-28`}>
        {label ? (
          <p className="mb-4 font-mono text-xs text-accent">{label}</p>
        ) : null}
        {title ? (
          <h2 className="max-w-2xl font-display text-2xl font-medium leading-tight tracking-[-0.01em] text-text sm:text-[2rem]">
            {title}
          </h2>
        ) : null}
        {intro ? (
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
            {intro}
          </p>
        ) : null}
        <div className={title || intro ? "mt-12" : ""}>{children}</div>
      </div>
    </section>
  );
}
