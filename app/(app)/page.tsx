import { auth } from "@clerk/nextjs/server";

import { InviteForm } from "@/components/invite-form";

/*
 * The workspace home. The current organization is read from the session token
 * on the server and rendered into the first paint, so the identity of the team
 * is part of the HTML rather than resolved a moment later in the browser.
 *
 * Membership is optional, so there may be no active organization. That is a
 * first-class state here, not an error: the switcher in the header is where a
 * user picks or creates one.
 */
export default async function WorkspacePage() {
  const { userId, orgId, orgRole, sessionClaims } = await auth();
  const orgName = sessionClaims?.org_name;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold text-text">
          {orgName ?? "Workspace"}
        </h1>
        <p className="text-muted">
          {orgId
            ? "You are working in the organization below. Switch or invite people from the header."
            : "You have no active organization. Choose or create one from the header to begin."}
        </p>
      </header>

      {orgId ? (
        <>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 rounded border border-border bg-raised px-4 py-4">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Organization
            </dt>
            <dd className="font-mono text-text">
              {orgName ? `${orgName} · ${orgId}` : orgId}
            </dd>

            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Your role
            </dt>
            <dd className="font-mono text-text">{orgRole}</dd>

            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
              User
            </dt>
            <dd className="font-mono text-text">{userId}</dd>
          </dl>

          <section className="max-w-md rounded border border-border bg-raised px-4 py-4">
            <InviteForm />
          </section>
        </>
      ) : null}
    </div>
  );
}
