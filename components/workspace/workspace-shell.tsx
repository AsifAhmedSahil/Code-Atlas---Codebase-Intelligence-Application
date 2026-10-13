import type { ReactNode } from "react";

// The three-column shell the application is built around: a narrow rail on the
// left, the map filling the middle, a detail pane on the right. It is settled
// here. Later phases fill these columns; they do not move them.
export function WorkspaceShell({
  rail,
  canvas,
  detail,
}: {
  rail: ReactNode;
  canvas: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      {rail}
      {canvas}
      {detail}
    </div>
  );
}