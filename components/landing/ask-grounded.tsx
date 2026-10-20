import { Section } from "./section";

/*
 * The signature behaviour: the lookup is printed before the answer. This shows
 * a compact transcript of that order — tool calls first, prose after.
 *
 * The example is illustrative, and it is labelled as such. Its filenames are
 * real files in this repository: lib/env.ts is imported by instrumentation.ts
 * and by both Supabase clients. It is not a capture of one specific run.
 */

const LOOKUPS = [
  { tool: "direct_neighbours", args: '("lib/env.ts", incoming)' },
  { tool: "search_files", args: '("env")' },
];

export function AskGrounded() {
  return (
    <Section
      id="ask"
      label="Ask"
      title="The answer comes after the evidence."
      intro="A structural question is answered by looking the facts up in the map first. The tool calls are shown before the prose, so the reasoning is inspectable rather than implied."
      width="wide"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="font-mono text-[10px] text-muted">Ask</span>
            <span className="font-mono text-[10px] text-muted">
              illustration
            </span>
          </div>
          <div className="border-b border-border px-4 py-4">
            <p className="text-sm text-text">
              What depends on{" "}
              <span className="font-mono text-[13px]">lib/env.ts</span>?
            </p>
          </div>
          <ol className="flex flex-col divide-y divide-border">
            {LOOKUPS.map((lookup) => (
              <li
                key={lookup.tool}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 font-mono text-[11px]"
              >
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                  tool
                </span>
                <span className="text-accent">{lookup.tool}</span>
                <span className="text-muted">{lookup.args}</span>
              </li>
            ))}
          </ol>
          <div className="px-4 py-4">
            <p className="mb-2 font-mono text-[10px] text-muted">answer</p>
            <p className="text-[13px] leading-relaxed text-text">
              Three files read from it. The server boots the environment check
              through{" "}
              <span className="font-mono text-[12px]">instrumentation.ts</span>,
              and both Supabase clients —{" "}
              <span className="font-mono text-[12px]">
                lib/supabase/server.ts
              </span>{" "}
              and{" "}
              <span className="font-mono text-[12px]">
                lib/supabase/client.ts
              </span>{" "}
              — read the public values from it. The edges are the parser&rsquo;s;
              only this sentence is the model&rsquo;s.
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <p className="max-w-[46ch] text-base leading-relaxed text-muted">
            The assistant never recalls an answer from memory. It picks a
            starting file and a direction, and the same arithmetic that draws
            the canvas performs the walk. Every fact in an answer traces back to
            a parsing result the page is already holding.
          </p>
          <ul className="mt-8 flex flex-col gap-3 border-t border-border pt-6">
            {[
              "Read-only graph tools — no writes, no other analysis",
              "The model cannot decide an edge or traverse the graph itself",
              "A tool call is shown before the sentence that uses it",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 text-sm text-text"
              >
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
