# Phase 8 — Framework adapters

**Goal.** The application recognises what kind of codebase it's looking at.

## Build

- An adapter for Next.js — roles from path conventions (App Router and Pages
  Router, at the root or under `src/`), and routes derived from those same
  paths.
- An adapter for NestJS — roles from filename suffixes, and routes assembled
  from decorators on the controller and the method together.
- An adapter for React, which is nearly free once Next.js exists.
- Extracted routes, stored and shown as a table.
- The left rail reshaping itself per framework, replacing the extension
  categories rather than prefixed onto them. A NestJS repository shows
  Controllers, Services, Modules, Entities. A Next.js one shows Page routes, API
  endpoints, Server actions, Layouts, Loading & error UI, Components, Hooks,
  Middleware, Metadata files, Instrumentation, Config files, Tests, Unclassified.
  A file a detected framework did not recognize is Unclassified, never a raw
  extension.

## Constraints

- **Routes are exact or absent.** Emit a route only when the method and the
  full pattern are both recoverable from the parsed syntax with no inference.
  If either has to be guessed, show nothing. A wrong route pattern is the same
  failure as an invented edge.
- Detection runs in a fixed order and the first match wins. A repository
  matching nothing still renders, with generic roles and an empty route table.
- A repository a framework claimed never falls back to extension categories. A
  file the adapter did not recognize is Unclassified.
- The rail taxonomy lives apart from the adapters themselves, so a browser
  component can read the list of category names without pulling a parser and a
  filesystem library into the bundle.
- Category names are the concrete role names, not abstractions. Someone reading
  a NestJS repository wants "Controllers 4", never "Entry points 4".
- Rail order is reading order and it stays fixed — routable surfaces first,
  then the layers behind them, then plumbing. The same repository always
  presents its categories in the same places.

## Acceptance check

1. Analyse a Next.js repository: the rail says Page routes, API endpoints,
   Server actions, and the counts are right — including one whose app lives
   under `src/`, where no file is left as a raw extension.
2. Analyse a NestJS repository: the rail says Controllers, Services, Modules,
   and the route table shows methods and full patterns.
3. Open three routes from that table and confirm by hand that the method and
   the path both match the code exactly.
4. Analyse something that matches no adapter — it renders, roles are generic,
   the route table is empty rather than wrong.
5. Search the parser core for the word "nextjs". It appears in the adapter and
   nowhere else.

`scripts/check-adapters.ts` covers 1–5 and the `src/` layout; `scripts/check-phase8.ts`
covers the rail order, the "no extension fallback" rule, the roles/routes
round-trip and re-run clearing, and the category-to-node filter.

## Not in this phase

AI classification of the files no adapter matched. They stay generic for now.
Express. `require()`.