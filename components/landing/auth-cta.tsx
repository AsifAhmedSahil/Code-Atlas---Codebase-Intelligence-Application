import { Show } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

/*
 * The product's one entry action, resolved by sign-in state on the server.
 *
 * Signed-out: "Map a public repository" goes to sign-up — the existing
 * registration flow, where a new account gets its own organization.
 * Signed-in: the same button opens the dashboard, so a returning visitor is
 * never pointed back at a sign-up page they don't need.
 *
 * <Show> reads the session, so it streams in behind a <Suspense> boundary and
 * the fallback is the signed-out variant — the safe default for a public page.
 */
export function AuthCta({
  className,
  signedOutLabel = "Map a public repository",
  signedInLabel = "Open dashboard",
}: {
  className: string;
  signedOutLabel?: string;
  signedInLabel?: string;
}) {
  return (
    <Suspense
      fallback={
        <Link href="/sign-up" className={className}>
          {signedOutLabel}
        </Link>
      }
    >
      <Show when="signed-out" fallback={null}>
        <Link href="/sign-up" className={className}>
          {signedOutLabel}
        </Link>
      </Show>
      <Show when="signed-in" fallback={null}>
        <Link href="/dashboard" className={className}>
          {signedInLabel}
        </Link>
      </Show>
    </Suspense>
  );
}
