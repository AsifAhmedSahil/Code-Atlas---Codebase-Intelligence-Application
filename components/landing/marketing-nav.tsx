import { Show } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

import { LINK_QUIET } from "./styles";

/*
 * Public navigation, aware of whether the visitor is signed in. Clerk's <Show>
 * reads the session, which is request-time data and cannot be part of the
 * static shell, so it streams in behind a <Suspense> boundary. The fallback is
 * the signed-out variant: an anonymous visitor is the common case here, and the
 * wrong direction (offering "Sign in" briefly to someone already signed in) is
 * the harmless one.
 *
 * Signed-out: Sign in + the product's entry action, which lands on sign-up.
 * Signed-in: a single link straight to the dashboard.
 */
export function MarketingNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6"
      >
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-base font-medium tracking-[-0.01em] text-text"
        >
          <span
            aria-hidden
            className="grid h-5 w-5 place-items-center rounded border border-border"
          >
            <span className="h-1.5 w-1.5 rounded-sm bg-accent" />
          </span>
          Cartograph
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <Suspense fallback={<SignedOutLinks />}>
            <Show when="signed-out" fallback={null}>
              <SignedOutLinks />
            </Show>
            <Show when="signed-in" fallback={null}>
              <Link
                href="/dashboard"
                className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Open dashboard
              </Link>
            </Show>
          </Suspense>
        </div>
      </nav>
    </header>
  );
}

function SignedOutLinks() {
  return (
    <>
      <Link href="/sign-in" className={`px-3 py-2 text-sm ${LINK_QUIET}`}>
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Map a repository
      </Link>
    </>
  );
}
