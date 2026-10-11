import { auth } from "@clerk/nextjs/server";

import { InviteForm } from "@/components/invite-form";
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
 * A run's status is the one place colour carries meaning here. Each state gets
 * its node and its word from the same token, so the rail and the label can
 * never disagree.
 */
const STATUS_NODE: Record<string, string> = {
  complete: "bg-incoming",
  running: "bg-accent",
  queued: "bg-muted",
  failed: "bg-outgoing",
};

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
            Cartograph maps one codebase per workspace. Choose one from the
            switcher above, or create one, and its runs appear here.
          </p>
        </div>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();
  const { data: analyses } = await supabase
    .from("analyses")
    .select("id, status, created_at, projects ( name, repo_url )")
    .order("created_at", { ascending: false });

  const runs = analyses ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
      <header className="flex max-w-[60ch] flex-col gap-3 pb-12">
        <h1 className="font-display text-[2rem] leading-[1.05] tracking-[-0.02em] text-text">
          {orgName ?? "Workspace"}
        </h1>
        <p className="text-[14px] leading-relaxed text-muted">
          Every mapping run this workspace has started, newest first. Choose
          another workspace from the header and this list changes with it.
        </p>
      </header>

      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-[15px] tracking-[-0.01em] text-text">
            Mapping runs
          </h2>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {runs.length} {runs.length === 1 ? "run" : "runs"}
          </span>
        </div>

        {runs.length > 0 ? (
          <ol className="flex flex-col">
            {runs.map((analysis, index) => {
              const isLast = index === runs.length - 1;
              const node = STATUS_NODE[analysis.status] ?? "bg-muted";
              const word = STATUS_WORD[analysis.status] ?? "text-muted";

              return (
                <li
                  key={analysis.id}
                  className="grid grid-cols-[1rem_1fr] gap-x-4"
                >
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-6 size-2 rounded-full ${node}`}
                      aria-hidden
                    />
                    {isLast ? null : (
                      <span className="w-px flex-1 bg-border" aria-hidden />
                    )}
                  </div>

                  <div
                    className={`flex flex-col gap-1 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 ${
                      isLast ? "" : "border-b border-border"
                    }`}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[14px] text-text">
                        {analysis.projects?.name ?? "Unknown project"}
                      </span>
                      {analysis.projects?.repo_url ? (
                        <span className="truncate font-mono text-[11px] text-muted">
                          {analysis.projects.repo_url}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-baseline gap-4">
                      <span className={`text-[12px] ${word}`}>
                        {analysis.status}
                      </span>
                      <time
                        dateTime={analysis.created_at}
                        className="font-mono text-[11px] tabular-nums text-muted"
                      >
                        {formatWhen(analysis.created_at)}
                      </time>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <p className="text-[14px] text-text">No runs yet</p>
            <p className="mx-auto mt-1 max-w-[44ch] text-[13px] leading-relaxed text-muted">
              When this workspace maps a repository, its files, routes, and
              dependencies will be charted here.
            </p>
          </div>
        )}
      </section>

      <section className="mt-14 border-t border-border pt-8">
        <InviteForm />
      </section>
    </div>
  );
}

function formatWhen(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
