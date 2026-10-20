import { Section } from "./section";

const STAGES = [
  {
    name: "Fetch",
    label: "Fetch",
    detail: "Download the repository archive for the public URL.",
  },
  {
    name: "Select",
    label: "Select",
    detail: "Unpack what was downloaded and choose what to read.",
  },
  {
    name: "Parse",
    label: "Parse",
    detail:
      "Read files and imports with a real TypeScript/JavaScript parser. This is where every edge is decided.",
    emphasis: true,
  },
  {
    name: "Classify",
    label: "Classify",
    detail: "Label the files no convention could identify.",
  },
  {
    name: "Store",
    label: "Store",
    detail: "Save the map, file by file, so it can be read back.",
  },
];

/*
 * The five stages are the real pipeline, in order, so the numbers encode the
 * sequence rather than decorate it. Parse is called out because that is the
 * stage that decides the graph — Classify names files, it does not draw lines.
 */
export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      label="How it works"
      title="A repository is parsed in five named stages, then read off the map."
      width="wide"
    >
      <ol className="grid gap-x-6 gap-y-8 md:grid-cols-5">
        {STAGES.map((stage, i) => (
          <li key={stage.name} className="relative flex flex-col">
            {/* connector from this stage to the next, desktop only */}
            {i < STAGES.length - 1 ? (
              <span
                aria-hidden
                className="absolute left-0 top-3 hidden h-px w-full bg-border md:block"
              />
            ) : null}
            <div className="relative flex items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${
                  stage.emphasis
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-surface text-muted"
                }`}
              >
                {i + 1}
              </span>
              <span className="bg-surface pr-2 font-display text-sm font-medium text-text">
                {stage.label}
              </span>
            </div>
            <p className="mt-3 max-w-[26ch] text-sm leading-relaxed text-muted">
              {stage.detail}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
