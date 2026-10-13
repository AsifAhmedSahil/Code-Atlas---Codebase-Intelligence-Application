import type { GraphDatum } from "./map-graph";
import { MapGraph } from "./map-graph";

// The middle column is where the map is drawn. Until data is present it stays
// an empty canvas; the shell around it is settled and will not be rearranged.
export function MapCanvas({ datum }: { datum?: GraphDatum }) {
  if (!datum) {
    return (
      <div className="relative min-w-0 flex-1 overflow-hidden bg-surface">
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="max-w-[40ch] text-center text-[13px] leading-relaxed text-muted">
            The dependency map is drawn here.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden bg-surface">
      <MapGraph datum={datum} />
    </div>
  );
}