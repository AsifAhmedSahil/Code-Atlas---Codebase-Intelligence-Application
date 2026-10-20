import { Show } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

import { LINK_QUIET } from "./styles";

/*
 * Public footer. No invented social links, no status page, no logos — only the
 * destinations that actually exist. The links follow sign-in state so a
 * returning visitor is not offered "Sign in" again; the session read streams in
 * behind a boundary, defaulting to the signed-out variant.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-display text-sm font-medium text-text">
            RepoScope
          </span>
          <span className="text-xs text-muted">
            Map a codebase from the code itself.
          </span>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <Suspense fallback={<SignedOutFooterLinks />}>
            <Show when="signed-out" fallback={null}>
              <SignedOutFooterLinks />
            </Show>
            <Show when="signed-in" fallback={null}>
              <Link href="/dashboard" className={LINK_QUIET}>
                Dashboard
              </Link>
            </Show>
          </Suspense>
        </div>
      </div>
    </footer>
  );
}

function SignedOutFooterLinks() {
  return (
    <>
      <Link href="/sign-in" className={LINK_QUIET}>
        Sign in
      </Link>
      <Link href="/sign-up" className={LINK_QUIET}>
        Map a repository
      </Link>
    </>
  );
}
