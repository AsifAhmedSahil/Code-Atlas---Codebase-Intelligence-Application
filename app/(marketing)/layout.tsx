import type { Metadata } from "next";

/*
 * Public marketing shell. Deliberately not the (app) shell: an anonymous
 * visitor must never see the organization switcher or the user button, and the
 * marketing page must not inherit the workspace's fixed-height, internally
 * scrolling layout. This layout wraps only public marketing routes.
 */

export const metadata: Metadata = {
  title: "Cartograph — Map a codebase from the code itself",
  description:
    "Paste a public TypeScript or JavaScript repository and get an interactive dependency map built by really parsing the code. Every node and edge comes from the parser, never from a model.",
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-surface text-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30 focus:rounded-md focus:border focus:border-border focus:bg-raised focus:px-4 focus:py-2 focus:text-sm focus:text-text"
      >
        Skip to content
      </a>
      {children}
    </div>
  );
}
