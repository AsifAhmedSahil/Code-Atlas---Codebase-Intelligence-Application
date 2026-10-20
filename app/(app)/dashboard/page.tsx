import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { InviteForm } from "@/components/invite-form";
import { LiveRunStatus } from "@/components/live-run-status";
import { RepoForm } from "@/components/repo-form";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/*
 * The dashboard. It asks the database for every analysis it is willing to
 * return and never names an organization in the query: the row-level policy
 * decides what that is. Switching organization issues the same query and gets a
 * different set back, which is the whole point of authorizing in the database
 * rather than here.
 */

/*
 * Reading the session token and the organization's own rows is request-time
 * data, so this segment blocks instead of prerendering. That is deliberate:
 * nothing here can be cached across organizations or users.
 */
export const instant = false;

/*
 * A run's status is the one place colour carries meaning here, and a finished
 * run is the only one whose word is drawn here: a run still going is rendered
 * by LiveRunStatus, which is where the live state and its colour live.
 */
const STATUS_WORD: Record<string, string> = {
  complete: "text-incoming",
  running: "text-accent",
  queued: "text-muted",
  failed: "text-outgoing",
};

export default async function WorkspacePage() {
  const { orgId, sessionClaims } = await auth();
  const orgName = sessionClaims?.org_name;

  if (!orgId) {
    return (
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <div className="flex max-w-[56ch] flex-col gap-4">
          <h1 className="font-display text-[1.75rem] leading-[1.1] tracking-[-0.02em] text-text">
            No workspace selected
          </h1>
          <p className="text-[14px] leading-relaxed text-muted">
            RepoScope maps one codebase per workspace. Choose one from the
            switcher above, or create one, and its runs appear here.
          </p>
        </div>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();
  const { data: analyses } = await supabase
    .from("analyses")
    .select("id, status, stage_message, created_at, projects ( name, repo_url )")
    .order("created_at", { ascending: false });

  const runs = analyses ?? [];
  const activeRuns = runs.filter(
    (analysis) => analysis.status === "queued" || analysis.status === "running"
  ).length;

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-5 py-9 sm:px-8 sm:py-14">
      <header className="mb-9 flex flex-col justify-between gap-6 border-b border-border pb-8 sm:mb-11 sm:flex-row sm:items-end">
        <div className="max-w-[60ch]">
          <p className="mb-3 flex items-center gap-2 font-mono text-[10px] tracking-[0.04em] text-muted">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
            Workspace overview
          </p>
          <h1 className="font-display text-[2.25rem] leading-[1.02] tracking-[-0.045em] text-text sm:text-[3rem]">
            {orgName ?? "Workspace"}
          </h1>
          <p className="mt-3 max-w-[54ch] text-[14px] leading-relaxed text-muted">
            Your team’s map room. Start with a repository or reopen a recent
            analysis.
          </p>
        </div>
        <dl className="flex shrink-0 gap-3 sm:pb-1">
          <div className="min-w-28 rounded-lg border border-border bg-raised px-4 py-3">
            <dt className="font-mono text-[9px] text-muted">
              Total maps
            </dt>
            <dd className="mt-1 font-display text-[1.55rem] leading-none tracking-[-0.04em] text-text">
              {runs.length}
            </dd>
          </div>
          <div className="min-w-28 rounded-lg border border-border bg-raised px-4 py-3">
            <dt className="font-mono text-[9px] text-muted">
              In progress
            </dt>
            <dd className="mt-1 flex items-center gap-2 font-display text-[1.55rem] leading-none tracking-[-0.04em] text-text">
              {activeRuns > 0 ? (
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-accent motion-safe:animate-pulse"
                />
              ) : null}
              {activeRuns}
            </dd>
          </div>
        </dl>
      </header>

      <section className="mb-12 grid gap-6 overflow-hidden rounded-xl border border-border bg-raised/50 p-5 sm:grid-cols-[0.8fr_1.2fr] sm:gap-10 sm:p-7">
        <div className="flex flex-col justify-center">
        <span className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1 font-mono text-[9px] text-muted">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-incoming" />
            Start here
          </span>
          <h2 className="font-display text-[1.55rem] leading-tight tracking-[-0.035em] text-text">
            See how the code connects.
          </h2>
          <p className="mt-2 max-w-[38ch] text-[13px] leading-relaxed text-muted">
            Add a public GitHub repository and RepoScope will build a map from
            its source.
          </p>
          <div aria-hidden="true" className="mt-5 hidden items-center gap-2 sm:flex">
            <span className="size-2 rounded-full border border-accent bg-accent/15" />
            <span className="h-px w-8 bg-border" />
            <span className="size-2 rounded-full border border-incoming bg-incoming/15" />
            <span className="h-px w-8 bg-border" />
            <span className="size-2 rounded-full border border-outgoing bg-outgoing/15" />
          </div>
        </div>
        <div className="flex items-center rounded-lg border border-border bg-surface p-4 sm:p-5">
          <div className="w-full">
            <RepoForm />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-[1.3rem] font-medium tracking-[-0.03em] text-text">
            Recent maps
          </h2>
          {runs.length > 0 ? (
            <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] tabular-nums text-muted">
              {runs.length} {runs.length === 1 ? "map" : "maps"}
            </span>
          ) : null}
        </div>

        {runs.length > 0 ? (
          <ol className="flex flex-col">
            {runs.map((analysis) => {
              const unfinished =
                analysis.status === "queued" || analysis.status === "running";
              const word = STATUS_WORD[analysis.status] ?? "text-muted";

              return (
                <li
                  key={analysis.id}
                  className="mb-2 overflow-hidden rounded-lg border border-border bg-surface last:mb-0"
                >
                  <Link
                    href={`/analyses/${analysis.id}`}
                    className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:flex-row sm:items-center sm:justify-between sm:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-raised font-mono text-[11px] text-accent"
                      >
                        ↗
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[14px] text-text group-hover:text-accent">
                          {analysis.projects?.name ?? "Repository"}
                        </span>
                        {analysis.projects?.repo_url ? (
                          <span className="truncate font-mono text-[11px] text-muted">
                            {analysis.projects.repo_url}
                          </span>
                        ) : null}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center justify-between gap-4 pl-12 sm:justify-end sm:pl-0">
                      {unfinished ? (
                        <LiveRunStatus
                          analysisId={analysis.id}
                          status={analysis.status}
                          stageMessage={analysis.stage_message}
                        />
                      ) : (
                        <span className={`text-[12px] ${word}`}>
                          {analysis.status}
                        </span>
                      )}
                      <time
                        dateTime={analysis.created_at}
                        className="font-mono text-[11px] tabular-nums text-muted"
                      >
                        {formatWhen(analysis.created_at)}
                      </time>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-raised/40 px-6 py-12 text-center sm:py-14">
            <div
              aria-hidden="true"
              className="mb-5 grid size-12 place-items-center rounded-xl border border-border bg-surface text-accent"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="size-6"
                stroke="currentColor"
                strokeWidth="1.4"
              >
                <circle cx="5" cy="6" r="2" />
                <circle cx="19" cy="7" r="2" />
                <circle cx="12" cy="18" r="2" />
                <path d="m7 6.5 10 0.3M6.2 7.7l4.7 8.5m6.9-7.7-4.7 7.7" />
              </svg>
            </div>
            <p className="font-display text-[1.15rem] tracking-[-0.025em] text-text">
              Your first map starts here
            </p>
            <p className="mx-auto mt-2 max-w-[44ch] text-[13px] leading-relaxed text-muted">
              Paste a public repository above to see its files, routes, and
              dependencies connected in one place.
            </p>
          </div>
        )}
      </section>

      <section className="mt-14 rounded-xl border border-border bg-raised/40 p-5 sm:p-6">
        <InviteForm />
      </section>
    </div>
  );
}

function formatWhen(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
