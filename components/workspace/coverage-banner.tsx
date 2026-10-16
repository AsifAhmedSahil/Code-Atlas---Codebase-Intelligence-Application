"use client";

// The coverage banner sits above the map and names, in plain numbers, what the
// import graph includes and what it leaves out. It is never hidden: a collapsed
// line still carries the figure, so a map that is quietly incomplete can never
// read as complete. The figure counts only internal imports — a package whose
// code is not in the analysed copy is a gap in the external direction, not in
// the graph the map draws.

import { useState } from "react";

import { coverageFigure } from "@/lib/map/coverage";
import type { Coverage } from "@/lib/parser/types";

export function CoverageBanner({ coverage }: { coverage: Coverage }) {
  const figure = coverageFigure(coverage);
  const [open, setOpen] = useState(figure.partial);
  const internal = figure.resolved + figure.unresolved;

  return (
    <div className="shrink-0 border-b border-border bg-raised px-4 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span aria-hidden className="text-muted">
          {open ? "▾" : "▸"}
        </span>
        <span className="text-xs font-medium text-muted">
          {figure.partial
            ? `Partial map — ${figure.percent}% of ${internal} internal imports resolved`
            : `Map complete — all ${figure.resolved} internal imports resolved`}
        </span>
      </button>
      {open && (
        <p className="mt-1 pl-5 text-xs text-muted">
          Internal imports: {figure.resolved} resolved, {figure.unresolved}{" "}
          unresolved. External imports: {figure.externalUnresolved} unresolved
          package{plural(figure.externalUnresolved)}, {figure.external} other.
          Excluded on purpose: {figure.excluded}. {figure.importsSeen} imports
          seen in total.
        </p>
      )}
    </div>
  );
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
