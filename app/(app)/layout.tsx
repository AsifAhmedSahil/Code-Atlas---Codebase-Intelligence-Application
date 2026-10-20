import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

/*
 * Reading the session token is runtime data, so this segment blocks rather
 * than prerendering. That is deliberate: the current organization has to be in
 * the server-rendered HTML, not streamed in or resolved in the browser.
 */
export const instant = false;

/*
 * The application shell everything later renders inside. The proxy already
 * turns signed-out visitors away before this renders; auth.protect() here is
 * the resource's own check, not a substitute for the ones on each page.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await auth.protect();

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-11 items-center justify-between border-b border-border bg-raised px-4">
        <Link
          href="/dashboard"
          className="font-display text-[13px] font-medium tracking-[-0.01em] text-text"
        >
          RepoScope
        </Link>
        <div className="flex items-center gap-3">
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/dashboard"
            afterCreateOrganizationUrl="/dashboard"
          />
          <ThemeToggle />
          <UserButton />
        </div>
      </header>
      {/* The shell is exactly the viewport tall. Pages that are taller than the
          screen scroll here; the workspace page instead fits the height and
          scrolls its own columns, so asking a question never moves the map or
          the left rail. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
