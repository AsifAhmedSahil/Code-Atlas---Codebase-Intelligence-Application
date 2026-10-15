import type { FileCategory } from "./categories";
import { useWorkspace } from "./workspace-context";

interface FileRailProps {
  categories: readonly FileCategory[];
  total: number;
}

// The narrow rail: what kinds of file are on the canvas, and how many of each.
// Clicking a kind dims everything that is not in it — it never removes
// anything, so the shape of the whole repository stays visible while one kind
// of file stands out. Clicking it again puts everything back.
export function FileRail({ categories, total }: FileRailProps) {
  const { category, setCategory } = useWorkspace();

  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-baseline justify-between px-3 pb-2 pt-3">
        <span className="text-[11px] font-medium text-muted">Files</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">{total}</span>
      </div>
      <ul className="flex flex-col">
        {categories.map((one) => {
          const active = category === one.kind;
          return (
            <li key={one.kind}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(active ? null : one.kind)}
                title={
                  active
                    ? `Show everything again`
                    : `Dim everything that is not ${one.name}`
                }
                className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left transition ${
                  active ? "bg-accent/10" : "hover:bg-accent/5"
                }`}
              >
                <span className={`size-2 shrink-0 rounded-[2px] ${one.swatch}`} aria-hidden />
                <span
                  className={`min-w-0 flex-1 truncate text-[12px] ${
                    active ? "text-accent" : "text-text"
                  }`}
                >
                  {one.name}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-muted">{one.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {category !== null && (
        <p className="px-3 pt-2 text-[11px] leading-relaxed text-muted">
          Everything except {categories.find((one) => one.kind === category)?.name} is dimmed.
          Click again to show all.
        </p>
      )}
    </aside>
  );
}
