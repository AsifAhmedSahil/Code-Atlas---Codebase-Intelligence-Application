import { Section } from "./section";

const BOUNDARIES = [
  {
    title: "Public repositories only",
    body: "You paste a public GitHub URL. Sign-in is for identity, not repository access — no repository token is requested or stored.",
  },
  {
    title: "The parser draws the graph",
    body: "The model may explain and label, and it may retrieve facts. It never decides that two files are connected.",
  },
  {
    title: "Scoped to your organization",
    body: "An analysis belongs to an organization, and what you can see follows from your organization claim — enforced in the database, not just the interface.",
  },
  {
    title: "Maps, not reviews",
    body: "There are no scores, severity badges, or issues-found. RepoScope shows you the shape of the code; it does not grade it.",
  },
];

/*
 * Boundaries are stated as rules, not badges. A ruled list with a mono index
 * reads like a spec, which is the honest register for limits — the opposite of
 * a grid of reassuring checkmarks.
 */
export function Boundaries() {
  return (
    <Section
      id="boundaries"
      label="Scope and access"
      title="Stated plainly, so nothing here is oversold."
      width="wide"
    >
      <dl className="grid gap-x-12 gap-y-0 md:grid-cols-2">
        {BOUNDARIES.map((b, i) => (
          <div
            key={b.title}
            className="flex gap-5 border-t border-border py-6"
          >
            <span className="mt-0.5 font-mono text-xs text-muted">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <dt className="font-display text-base font-medium text-text">
                {b.title}
              </dt>
              <dd className="mt-2 max-w-[44ch] text-sm leading-relaxed text-muted">
                {b.body}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </Section>
  );
}
