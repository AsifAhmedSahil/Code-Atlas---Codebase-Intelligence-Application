// How complete the internal import graph is, read off the parser's own coverage
// numbers. It is arithmetic, not a grade: of the imports that pointed inside the
// repository, how many resolved to a file the map can draw. An import that
// resolved outside the repository — including a package whose code is simply not
// in the analysed tree — or that was excluded on purpose, is not a gap. Only an
// unresolved internal import lowers the figure.

import type { Coverage } from "@/lib/parser/types";

// Below this the map is called partial. The figure is named either way, so a
// graph that is quietly half-complete can never look whole.
export const COVERAGE_FLOOR = 95;

export interface CoverageFigure {
  // Whole percent, 0–100.
  percent: number;
  partial: boolean;
  resolved: number;
  // Internal imports that did not resolve to a file: the real gaps.
  unresolved: number;
  // Unresolved external package imports (dependencies absent from the analysed
  // copy). A gap in the external direction, never counted against the figure.
  externalUnresolved: number;
  // Imports that point outside the repository and are not unresolved packages.
  external: number;
  excluded: number;
  importsSeen: number;
}

export function coverageFigure(coverage: Coverage): CoverageFigure {
  const resolved = coverage.resolved;
  const unresolved = coverage.failed;
  const externalUnresolved = coverage.externalUnresolved ?? 0;
  const outside = coverage.outside;
  const considered = resolved + unresolved;
  // No internal imports to resolve is not a gap; the graph is whole.
  const percent = considered === 0 ? 100 : Math.round((resolved / considered) * 100);
  return {
    percent,
    partial: percent < COVERAGE_FLOOR,
    resolved,
    unresolved,
    externalUnresolved,
    external: Math.max(0, outside - externalUnresolved),
    excluded: coverage.excluded,
    importsSeen: coverage.importsSeen,
  };
}
