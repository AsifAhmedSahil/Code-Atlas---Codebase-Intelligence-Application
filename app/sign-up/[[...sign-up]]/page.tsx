import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

/*
 * Public route. Signing up creates the account and, with automatic
 * organization creation enabled, lands the new user in an organization of
 * their own rather than an empty state. Streamed in behind Suspense for the
 * same reason as the sign-in page.
 */
export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Suspense fallback={<AuthFormFallback />}>
        <SignUp />
      </Suspense>
    </div>
  );
}

function AuthFormFallback() {
  return (
    <div
      aria-hidden
      className="h-[400px] w-full max-w-[400px] rounded border border-border bg-raised"
    />
  );
}
