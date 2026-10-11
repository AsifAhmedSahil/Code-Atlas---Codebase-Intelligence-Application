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
    <div className="flex min-h-screen flex-col">
      <header className="flex h-11 items-center justify-between border-b border-border bg-raised px-4">
        <Link
          href="/"
          className="font-mono text-[12px] font-medium tracking-tight text-text"
        >
          Cartograph
        </Link>
        <div className="flex items-center gap-3">
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/"
            afterCreateOrganizationUrl="/"
          />
          <ThemeToggle />
          <UserButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
