import type { AdapterContext, FrameworkAdapter } from "../framework";
import { expressAdapter } from "./express";
import { nestAdapter } from "./nest";
import { nextAdapter } from "./next";
import { reactAdapter } from "./react";

// Detection runs in this order and the first match wins. The order is a
// decision, not an accident: each earlier framework is the more specific claim.
// A repository that depends on both Next.js and React is a Next.js repository,
// because that is the framework whose conventions actually shape the files.
// Express is tried last: it says little about the layout, so a repository that
// also declares a more opinionated framework keeps that framework.
const ADAPTERS: readonly FrameworkAdapter[] = [
  nextAdapter,
  nestAdapter,
  reactAdapter,
  expressAdapter,
];

// The fallback. Every source file is a node, every role comes from the
// extension, and no route is claimed, so a repository that matches nothing
// still renders — just without a framework.
export const noFrameworkAdapter: FrameworkAdapter = Object.freeze({
  name: "none",
  detect: () => true,
  role: () => null,
  routes: () => [],
});

export function detectAdapter(context: AdapterContext): FrameworkAdapter {
  return ADAPTERS.find((adapter) => adapter.detect(context)) ?? noFrameworkAdapter;
}

// The adapter a stored parse was produced with, looked up by the name it
// recorded. An unknown name falls back to the one that knows no framework, so
// reading an older parse never fails on a missing adapter.
export function adapterFor(name: string): FrameworkAdapter {
  if (name === noFrameworkAdapter.name) return noFrameworkAdapter;
  return ADAPTERS.find((adapter) => adapter.name === name) ?? noFrameworkAdapter;
}

export { expressAdapter, nestAdapter, nextAdapter, reactAdapter };
