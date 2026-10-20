import { Show } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

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
    <header className="atlas-nav">
      <nav aria-label="Primary" className="atlas-nav-inner">
        <Link
          href="/"
          className="atlas-brand"
        >
          <span className="atlas-brand-symbol" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M5 22.5 14 5l5 10 8-5-8 17-5-10-9 5.5Z" />
              <circle cx="19" cy="15" r="2.2" />
            </svg>
          </span>
          <span>RepoScope</span>
          <span className="atlas-brand-edition">CODE INTELLIGENCE</span>
        </Link>
        <div className="atlas-nav-center">
          <Link href="#how-it-works" className="atlas-nav-link">How it works</Link>
          <Link href="#ask" className="atlas-nav-link">Grounded answers</Link>
        </div>
        <div className="atlas-nav-actions">
          <Suspense fallback={<SignedOutLinks />}>
            <Show when="signed-out" fallback={null}>
              <SignedOutLinks />
            </Show>
            <Show when="signed-in" fallback={null}>
              <Link
                href="/dashboard"
                className="atlas-button atlas-button-primary"
              >
                Dashboard
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
      <Link href="/sign-in" className="atlas-sign-in">
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className="atlas-nav-button"
      >
        Map a repository
      </Link>
    </>
  );
}
