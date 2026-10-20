/*
 * Shared class strings for the marketing page, in one place so a button looks
 * like the same button everywhere. Not a component — the components stay
 * explicit about what element they render, and the chrome stays consistent.
 */

/* The product's single entry action: blue, because colour means "interactive". */
export const CTA_PRIMARY =
  "inline-flex h-11 items-center rounded-md bg-accent px-6 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/* A quieter companion, for a secondary path such as "See how it works". */
export const CTA_SECONDARY =
  "inline-flex h-11 items-center rounded-md border border-border px-6 text-sm font-medium text-text transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/* A plain text link, used in the nav and footer. */
export const LINK_QUIET =
  "text-muted transition-colors hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-md";
