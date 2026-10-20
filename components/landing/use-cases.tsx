import { Section } from "./section";

const LEAD = {
  tag: "inherited",
  title: "You inherited an agent-built repository",
  body: "Code was written across many sessions and shipped after a smoke test. Nothing here was ever held in one head, and the shape was never chosen on purpose. The map is the first time anyone has seen the whole of it.",
};

const SECONDARY = [
  {
    tag: "before a change",
    title: "A dependency you are afraid to touch",
    body: "Before changing a file, see what imports it and how far the change travels two hops out.",
  },
  {
    tag: "onboarding",
    title: "Bringing a new teammate up to speed",
    body: "Hand over the map instead of a reading list. The structure is answered by the same page everyone else reads.",
  },
];

/*
 * An asymmetric composition: one situation gets the space, two smaller ones sit
 * beside it. Differentiated weight rather than three equal columns, and no
 * invented quotes standing in for real users.
 */
export function UseCases() {
  return (
    <Section
      id="use-cases"
      label="Who it is for"
      title="For the developer opening code they did not write."
      width="wide"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-14">
        <article className="flex flex-col rounded-lg border border-border bg-raised p-8 sm:p-10">
          <span className="font-mono text-[11px] text-accent">
            {LEAD.tag}
          </span>
          <h3 className="mt-4 max-w-[20ch] font-display text-2xl font-medium leading-tight tracking-[-0.01em] text-text sm:text-3xl">
            {LEAD.title}
          </h3>
          <p className="mt-5 max-w-[44ch] text-sm leading-relaxed text-muted sm:text-base">
            {LEAD.body}
          </p>
        </article>

        <div className="flex flex-col gap-8">
          {SECONDARY.map((u) => (
            <article
              key={u.title}
              className="flex flex-1 flex-col border-t border-border pt-6"
            >
              <span className="font-mono text-[11px] text-muted">{u.tag}</span>
              <h3 className="mt-3 font-display text-lg font-medium leading-tight text-text">
                {u.title}
              </h3>
              <p className="mt-3 max-w-[44ch] text-sm leading-relaxed text-muted">
                {u.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </Section>
  );
}
