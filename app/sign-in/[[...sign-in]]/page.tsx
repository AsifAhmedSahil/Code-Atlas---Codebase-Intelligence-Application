import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

/*
 * Public route. Clerk reads the path it is mounted at, which is only known at
 * runtime, so the form is streamed in behind a Suspense boundary and the rest
 * of the page stays static. Clerk's component sends an already-signed-in
 * visitor on to the fallback redirect.
 */
export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Suspense fallback={<AuthFormFallback />}>
        <SignIn />
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
