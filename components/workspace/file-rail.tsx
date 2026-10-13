import type { FileCategory } from "./categories";

interface FileRailProps {
  categories: readonly FileCategory[];
  total: number;
}

// The narrow rail: what kinds of file are on the canvas, and how many of each.
// Nothing is clickable yet — the select behaviour lands together with the
// graph, so this stays a list in this phase.
export function FileRail({ categories, total }: FileRailProps) {
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-baseline justify-between px-3 pb-2 pt-3">
        <span className="text-[11px] font-medium text-muted">Files</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {total}
        </span>
      </div>
      <ul className="flex flex-col">
        {categories.map((category) => (
          <li key={category.kind} className="flex items-center gap-2.5 px-3 py-1.5">
            <span
              className={`size-2 shrink-0 rounded-[2px] ${category.swatch}`}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[12px] text-text">
              {category.name}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted">
              {category.count}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}