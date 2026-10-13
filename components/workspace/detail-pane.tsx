// The detail pane on the right. An empty column in this phase: whatever is
// selected on the map is inspected here, so it stays a column and never becomes
// a modal, a drawer, or an overlay.
export function DetailPane() {
  return (
    <aside
      aria-label="Detail pane"
      className="w-64 shrink-0 border-l border-border bg-surface"
    />
  );
}