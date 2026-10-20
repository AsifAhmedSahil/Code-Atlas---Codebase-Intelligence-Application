# Landing Page — Project Context Brief

> Research-only brief for a downstream AI assistant that will plan and implement
> a marketing/landing page for Cartograph. No landing page code was written and
> no application code was changed to produce this document.
>
> Evidence labels used throughout: **Verified** (directly supported by source or
> config I read), **Inferred** (reasonable reading of the evidence), **Unknown**
> (cannot be established from the repository).

---

## 0. How this brief was produced

Files actually read for this brief: `package.json`, `pnpm-lock.yaml`
(existence only), `pnpm-workspace.yaml`, `next.config.ts`, `tsconfig.json`,
`eslint.config.mjs`, `proxy.ts`, `instrumentation.ts`, `CLAUDE.md`, `AGENTS.md`,
`README.md`, `docs/project-doc.md`, `app/layout.tsx`, `app/globals.css`,
`app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/actions.ts`,
`app/(app)/analyses/[id]/page.tsx`, `app/api/analyses/route.ts`,
`app/api/analyses/[id]/run/route.ts`, `app/sign-in/[[...sign-in]]/page.tsx`,
`app/sign-up/[[...sign-up]]/page.tsx`, `components/repo-form.tsx`,
`components/theme-toggle.tsx`, `components/analysis-progress.tsx` (head),
`components/workspace/*` (ask-panel, detail-pane, workspace-view,
workspace-shell, workspace-context, file-rail, map-graph, explanation-tab,
coverage-banner), `agent/README.md`, `lib/env.ts`, `lib/ai/model.ts`,
`lib/parser/types.ts`, `lib/roles/taxonomy.ts`, `lib/pipeline/run.ts`,
`lib/pipeline/load.ts`, `supabase/migrations/20261011000000_init.sql`
(grep-level). The `demo-image/*.png` screenshots exist but **could not be viewed**
(the reviewing model cannot accept image input) — they are listed as an asset,
not described.

Not run for this brief: no build, lint, typecheck, tests, or dev server. No
claims about passing checks are made.

---

## 1. Executive product summary

**Cartograph** maps a public GitHub TypeScript/JavaScript repository into an
interactive dependency graph and lets a developer interrogate it. Sign in, paste
a public repo URL, and get a map: folders as boxes, imports as directional lines,
with per-file structure, a written explanation, and a question panel whose
answers are looked up in the map rather than recalled by a model.

The governing rule (**Verified**, `docs/project-doc.md`, `CLAUDE.md`): *every box
and every line comes from really parsing the code.* The AI may explain and label;
it may never decide two files are connected, and it may never walk the graph when
arithmetic can. A graph that is 90% right is treated as worse than none, because
the wrong 10% is invisible.

The problem it targets (**Verified**, `docs/project-doc.md`): teams now routinely
ship code nobody read (agent-written, shipped after a smoke test), accumulating
structure no one chose. The questions that follow are structural — what is this
file, what depends on it, what breaks if I change it — and answering them by
reading imports one file at a time stops working past ~30 files.

Positioning is deliberately *not* "AI describes your codebase" and *not* a code
reviewer (**Verified**, `docs/project-doc.md` "Out of scope"): no scores, no
severity badges, no issues-found, no model-decided edges. It is a **map**, drawn
from the parser, that a person reads.

---

## 2. Verified feature inventory

Each item is implemented in the repo unless marked otherwise.

### 2.1 Repository ingestion & analysis — **Verified**
- Public `github.com` URLs only. Sign-in (Clerk) is for identity only: no repo
  scope, no token storage (`docs/project-doc.md`; `components/repo-form.tsx`
  copy; `lib/pipeline/github.ts` referenced by `app/api/analyses/route.ts`).
- One analysis per repository per organization. Submitting an already-analysed
  URL returns the existing analysis instead of re-running it
  (`app/api/analyses/route.ts`).
- A run is a discrete, named pipeline: **fetch → select → parse → classify →
  store**, each stage written to the row as it begins
  (`lib/pipeline/run.ts:22`, `components/analysis-progress.tsx:16`).
- Runs are single-owner: a conditional `queued → running` claim means two tabs
  cannot both run the same analysis (`app/api/analyses/[id]/run/route.ts:86`).
- The pipeline runs *after* the response (`after()`), so the browser never awaits
  it; progress arrives over a Supabase realtime subscription
  (`app/api/analyses/[id]/run/route.ts:111`, `components/use-analysis-progress.ts`).
- Re-running is a deliberate act from a finished analysis, and clears the old
  stored rows first (`lib/pipeline/requeue.ts`, `components/rerun-button.tsx`).
- **Not present:** queues, workers, containers. Stated as out of scope and as an
  honest limit of a single deployable (`docs/project-doc.md` "Out of scope").

### 2.2 The parser / graph — **Verified**
- `ts-morph` parses TS/JS. Imports, re-exports, dynamic imports, and `require()`
  become edges (`docs/project-doc.md`; `lib/parser/*`).
- The parser is standalone: path in, data out, runnable from a plain script, and
  it may not import Next/React/the DB client (`CLAUDE.md:75`).
- Framework knowledge is an **adapter**, not a branch: Next.js, NestJS, Express,
  React adapters exist (`lib/parser/adapters/*`, `lib/parser/framework.ts`).
- Output is a versioned contract, `ParseResult`
  (`lib/parser/types.ts:123`): files, edges, roles, routes, skipped files, and a
  full coverage report.
- Coverage is first-class and un-hidden: every import lands in exactly one bucket
  (resolved / outside / excluded / failed) and the unresolved ones are kept in
  full (`lib/parser/types.ts:88`; `docs/project-doc.md` "Where this is likely to
  go wrong").
- Per-file fan-in/fan-out are stored (`lib/parser/types.ts:27`).

### 2.3 The map (graph canvas) — **Verified**
- React Flow (`@xyflow/react`) + dagre layout (`@dagrejs/dagre`). Folders fold
  into boxes; opening a box is a panel with its files as rows
  (`components/workspace/map-graph.tsx`, `components/workspace/map-layout.ts`).
- Directional edges are painted as two halves: outgoing = amber, incoming =
  green, with the arrowhead on the incoming end (`map-graph.tsx:91`).
- Selection dims everything not connected; hovering a path in the pane lights the
  matching row/node on the map and vice-versa (`map-graph.tsx:176`,
  `map-graph.tsx:428`).
- The left rail lists file *kinds* with counts; clicking one dims everything that
  is not that kind rather than removing it (`components/workspace/file-rail.tsx`).
- Node/edge interaction is intentionally inert: `nodesConnectable={false}`,
  `nodesDraggable={false}`, `deleteKeyCode={null}` (`map-graph.tsx:566`).

### 2.4 Right-hand pane — Structure / Routes / Explanation, and Ask — **Verified**
- Three tabs above the pane content: **Structure**, **Routes**, **Explanation**
  (`components/workspace/detail-pane.tsx:37`).
- **Structure**: resting state is the repository overview (files/imports/routes,
  most-depended-on, imported-by-nothing); a selection replaces it with that
  file's or folder's structure (`detail-pane.tsx:167`, `:406`). Selecting fires
  **no request** — it is arithmetic over data the browser already holds
  (`workspace-context.tsx:5`).
- **Blast radius** (inward) and **Dependency chain** (outward) are two transitive
  walks, both arithmetic over the edge list, 2 levels deep
  (`detail-pane.tsx:331`, `lib/map/walk.ts`).
- **Routes**: a table of routes recovered from syntax; a route is shown only when
  method and full path are both recoverable, else nothing
  (`detail-pane.tsx:453`; `docs/project-doc.md` "Out of scope").
- **Explanation**: a model-written paragraph built from the subject and its real
  neighbours. Cached (server cache read inside the traced call) and restorable
  across page loads; notes if tracing is off; shows a staleness note when the
  repo has moved (`components/workspace/explanation-tab.tsx`,
  `lib/ai/explain.ts`, `lib/ai/cache.ts`, `lib/ai/staleness.ts`).
- **Ask** is a **mode of the whole pane, not a tab** (`detail-pane.tsx:45`,
  `components/workspace/ask-panel.tsx:3`). Entering replaces the pane; leaving
  restores the previous tab and selection. It streams tokens and shows tool calls
  as they happen; tool results are printed before the answer, which is the
  product's signature behaviour (`docs/project-doc.md` "What has to be true
  before this ships").
- An **Insights** section sits under the pane, closed by default, listing
  cycles / isolated groups read off the edge list (`detail-pane.tsx:528`).

### 2.5 The Ask agent (Phase 12) — **Verified**
- A separate local HTTP service (`agent/server.ts`), reached over HTTP, holding
  six **read-only** graph tools (`lib/agent/tools.ts`): `analysis_summary`,
  `search_files`, `list_files_by_role`, `direct_neighbours`, `transitive_walk`,
  `route_table` (`agent/README.md:84`).
- The agent cannot write, cannot reach another analysis, and cannot walk the
  graph itself — the tools are pure functions of the authorized analysis's
  `ParseResult`, reusing the same `walkGraph`/`neighboursOf` the canvas uses
  (`agent/README.md:75`).
- Authorization: the web app mints a 5-minute HMAC-SHA256 scoped credential per
  question, only after reading the analysis back with the viewer's own
  row-scoped token. The credential is never sent to the browser; the browser
  talks to `/api/agent/run` (`agent/README.md:96`,
  `app/api/agent/run/route.ts`, `lib/agent/scope.ts`).
- **Known gap (Verified):** the spec named a managed "Deep Agents" runtime; that
  provider API is retired (HTTP 410). The runtime is a local OpenAI tool loop
  behind one swappable interface (`AgentRuntime`), with the gap documented
  (`agent/README.md:18`, `agent/runtime.ts`).
- The app **works with the agent stopped**; only Ask is unavailable
  (`agent/README.md:57`).

### 2.6 AI usage discipline — **Verified**
- One place constructs the AI client (`lib/ai/model.ts:41`), wrapped for tracing
  (`wrapOpenAI` + LangSmith). Model pinned to `gpt-4o-mini` with versioned
  prompts (`model.ts:14`, `:19`).
- Every AI call has a cache read inside its trace, so a cache hit is a recorded
  run with no model call (`CLAUDE.md:91`).
- The only AI jobs are **explain**, **classify unclassified files**, and the
  **Ask agent**. The model never produces an edge (`docs/project-doc.md`).

### 2.7 Auth, orgs, security — **Verified**
- Clerk for sign-in (GitHub/Google/email), organizations, and invitations
  (`@clerk/nextjs`; `app/(app)/actions.ts`). Admin-only invites, checked against
  the token role (`actions.ts:25`).
- Supabase Postgres with **row-level security on every table**, a single policy
  whose predicate reads the org claim off the JWT
  (`supabase/migrations/20261011000000_init.sql`).
- The reviewer/agent service holds a privileged key but scope is enforced by an
  `organization_id` filter on **every** child query in the loader
  (`lib/pipeline/load.ts:94`; `agent/README.md:123`).
- `proxy.ts` (Clerk middleware) makes **only** `/sign-in`, `/sign-up`,
  `/__clerk` public. Everything else redirects signed-out visitors to sign-in
  (`proxy.ts:10`).

### 2.8 What is planned / incomplete — **Verified**
- The product doc's "What has to be true before this ships" list is the
  acceptance bar, not a shipped guarantee.
- Managed Deep Agents availability is a recorded external gap
  (`agent/README.md:18`).
- The current `README.md` is the untouched Next.js starter — **no** product-level
  readme exists (**Verified**).
- **No public marketing/landing route exists** (**Verified** — see §4).

---

## 3. Technology stack

| Area | Choice | Evidence |
| --- | --- | --- |
| Framework | **Next.js 16.4.0**, App Router | `package.json:25`; `app/` structure |
| React | **19.3.0** | `package.json:27` |
| Language | TypeScript strict, no `any` | `tsconfig.json:11`; `CLAUDE.md:86` |
| Package manager | **pnpm 12.11.2** | `package.json:42`, `pnpm-workspace.yaml` |
| Styling | **Tailwind CSS v4** (`@tailwindcss/turbopack`) | `package.json:32-38`, `app/globals.css:1` |
| Fonts | `next/font/google`: **Geist**, **Geist Mono**, **Space Grotesk** (display) | `app/layout.tsx:6-19` |
| Graph | `@xyflow/react` 12 + `@dagrejs/dagre` 3 | `package.json:20,23` |
| Parsing | `ts-morph` 28 | `package.json:29` |
| Auth | Clerk (`@clerk/nextjs` 7) | `package.json:19` |
| DB | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) — Postgres + RLS + realtime | `package.json:21-22`; migrations |
| AI | OpenAI SDK 7 via one wrapped client; LangSmith tracing/eval | `lib/ai/model.ts`; `package.json:24,26` |
| Scripts runtime | `tsx` | `package.json:39` |
| Lint/tests | ESLint 9 (`eslint-config-next`). **No test runner, no Playwright/Cypress.** | `eslint.config.mjs`; `package.json` scripts |

**Scripts (`package.json:5`):** `dev`, `build`, `start`, `lint`, `parse`,
`agent`, `check:phase12`, `eval:paths`, `eval:roles`, `eval:prompts`,
`eval:agent`.

**Notable Next 16 flags (`next.config.ts`):** `cacheComponents: true`,
`partialPrefetching: true`, a turbopack CSS rule. `AGENTS.md` warns this Next
version diverges from training data — read `node_modules/next/dist/docs/`.

**Deployment config:** **Unknown.** No `vercel.json`, `Dockerfile`, CI workflow,
or hosting manifest was found. The starter `README.md` mentions Vercel but that is
boilerplate, not configuration.

---

## 4. Repository and route map

### 4.1 Routes that exist (Verified)
| Route | Access | Purpose | File |
| --- | --- | --- | --- |
| `/` | **Authenticated** (dashboard) | Org run list, repo form, invite form | `app/(app)/page.tsx` |
| `/analyses/[id]` | **Authenticated** | The workspace (map) or the progress/failed view | `app/(app)/analyses/[id]/page.tsx` |
| `/sign-in/*` | Public | Clerk `<SignIn/>` | `app/sign-in/[[...sign-in]]/page.tsx` |
| `/sign-up/*` | Public | Clerk `<SignUp/>` | `app/sign-up/[[...sign-up]]/page.tsx` |
| `/api/analyses` (POST) | Auth | Create/return an analysis | `app/api/analyses/route.ts` |
| `/api/analyses/[id]/run` (POST) | Auth | Claim + start/re-run a run | `app/api/analyses/[id]/run/route.ts` |
| `/api/agent/run` (POST) | Auth | Mint scoped credential + relay agent SSE | `app/api/agent/run/route.ts` |

### 4.2 Critically: there is no public home
- **Verified:** `app/page.tsx` does **not** exist (`Test-Path app\page.tsx` →
  False).
- **Verified:** `proxy.ts` treats everything except sign-in/sign-up/`__clerk` as
  protected (`proxy.ts:10`).
- **Consequence (Inferred):** a signed-out visitor to `/` is redirected to
  `/sign-in`. There is currently **no** anonymous page that markets the product.

### 4.3 Layout hierarchy (Verified)
- `app/layout.tsx` — root: `<html h-full>`, inline pre-paint theme script,
  `ClerkProvider`, fonts, `metadata` title/description.
- `app/(app)/layout.tsx` — the authenticated shell: fixed-height `h-dvh` column,
  a header (`Cartograph` wordmark → `/`, `OrganizationSwitcher`, `ThemeToggle`,
  `UserButton`), and `<main>` that scrolls internally. **This layout wraps every
  protected route** and is the one place a product wordmark/nav already lives.
- `app/(app)/analyses/[id]/page.tsx` — its own sub-header (back to Runs, project
  name, repo URL, file/edge counts, `RerunButton`) then `WorkspaceView`.
- `components/workspace/workspace-shell.tsx` — the settled three-column shell:
  rail (left), canvas (middle), detail pane (right). Comment: "It is settled
  here. Later phases fill these columns; they do not move them."

---

## 5. Existing UI and design system

### 5.1 Design tokens (`app/globals.css`) — **Verified**
Every colour is a single `light-dark()` value chosen by `color-scheme` on the
root, so forcing light wins over a dark system without redefining tokens:
- Surfaces: `--surface` (#ffffff / #0a0a0a), `--raised` (#f5f6f7 / #141517)
- `--border` (#e3e5e8 / #27292c), `--text` (#17181a / #ededed),
  `--muted` (#6a6f75 / #8a9096)
- Accent blue (#2563eb / #3b82f6); **incoming green** (#15803d / #22c55e);
  **outgoing amber** (#b45309 / #f59e0b)
- Six file-kind hues: teal/violet/rose/lime/slate/other, deliberately chosen not
  to collide with direction colours or the accent (`globals.css:22`).
- Tailwind theme mapping in `@theme inline` exposes these as `bg-surface`,
  `text-muted`, etc., plus font families `--font-sans/mono/display`.

### 5.2 Type & density — **Verified**
- Body font-size **13px**, line-height 1.5 (`globals.css:83`). Comments across
  components use `text-[12px]`, `text-[11px]`, `text-[10px]` heavily — a dense,
  small-type developer tool, not a marketing site.
- File paths are monospace everywhere; display headings use Space Grotesk
  (`font-display`).
- Explicit design intent (`docs/project-doc.md`): "A dense developer tool, not a
  dashboard. Small type, tight spacing, monospace for anything that is a file
  path." `CLAUDE.md:96` repeats it and warns the frontend-design skill's pull
  toward motion/big-type is overruled.

### 5.3 Reusable primitives (Verified, in-repo)
- **Button/input look** exists only as utility-class strings, not components:
  accent button = `h-9 rounded-md bg-accent px-4 text-[13px] font-medium text-white` (`repo-form.tsx:70`); input = `h-9 rounded-md border border-border bg-raised px-3 font-mono text-[12px]` (`repo-form.tsx:65`).
- **`ThemeToggle`** (`components/theme-toggle.tsx`) — three-state, cookie-backed,
  hydration-safe. Reusable on any page including a public one.
- **`RepoForm`** (`components/repo-form.tsx`) — the "paste a URL" entry point;
  POSTs `/api/analyses`. Auth-dependent (needs an org) but the visual is reusable
  as a hero CTA *concept*.
- **`CoverageBanner`**, **`FileRail`**, `categories.ts` (swatches) — workspace
  primitives, tied to a `ParseResult`.
- **`RerunButton`**, **`AnalysisProgress`**, **`LiveRunStatus`** — run lifecycle
  UI.

### 5.4 What looks like what — **Inferred**
- The product UI reads as a **dense developer tool** (IDE-adjacent), not a SaaS
  dashboard or docs site: monospace paths, greyscale chrome, colour reserved for
  direction and file-kind. This is a *product* surface with no marketing layer.
- A landing page will need its **own** visual language — the product's 13px
  density and greyscale chrome are deliberately unwelcoming as marketing. The
  tokens (palette, fonts) can be reused; the density should not be.

### 5.5 Inconsistencies/weaknesses (noted, not to be refactored here)
- No shared `<Button>`/`<Input>` components — styles are repeated strings. **Not**
  a blocker for a landing page, which will define its own.
- `README.md` is the untouched starter (no product copy) — a landing page is the
  first real public-facing copy the project would have.
- **Unknown:** `demo-image/*.png` exist (5 files, incl. `image.png`) but their
  content could not be inspected.

---

## 6. Product positioning and target users

### 6.1 Problem — **Verified** (`docs/project-doc.md`)
Codebases contain code nobody read (agent-written, smoke-tested, shipped).
Structural questions ("what depends on this, what breaks") are answered today by
reading imports one file at a time, which collapses past ~30 files.

### 6.2 Audience / personas — **Verified/Inferred**
- **Primary (Verified):** "a developer opening a codebase they didn't write —
  most often one they built themselves with an agent, across many sessions, and
  can no longer hold in their head. They can read code fine. What they can't see
  is its shape."
- **Secondary (Verified):** a small team all shipping this way; and the next
  joiner who inherits it at once. Hence analyses belong to an *organization*, not
  a person.
- **Not the audience (Verified):** people who want a code review, a score, or a
  security rating.

### 6.3 Core benefit — **Verified/Inferred**
Turn "hold the shape of a codebase in your head" into "read it off a map that is
provably drawn from the code", and answer structural questions by looking up
facts instead of guessing.

### 6.4 Strongest demonstrable capabilities (all Verified)
1. **Every edge is parsed, never guessed** — imports/re-exports/dynamic/`require`
   become edges; coverage is reported and un-hidden.
2. **Blast radius & dependency chain** as arithmetic (instant, no spinner) — the
   two questions a task or a change forces.
3. **Explanation grounded in real neighbours** — a written paragraph from the
   subject and the files that actually import it/are imported by it.
4. **Ask a question, watch it look it up** — tool calls are shown before the
   answer; the agent reads the map through six read-only tools and cannot invent
   a path.
5. **Organizations + RLS** — a repository is mapped once, and what you can see
   follows from the org claim, enforced in the database policy, not the UI.

### 6.5 Realistic primary CTA — **Inferred**
"Map a public repository" → sign-in → dashboard. The product's only entry action
is a public GitHub URL, so the landing CTA should be **sign in / start mapping**,
not "book a demo" or "request access" (no such flow exists).

### 6.6 First five seconds — **Inferred**
Communicate: *"See the shape of a codebase you didn't write — a dependency map
built by really parsing the code, with an assistant that looks answers up in the
map."* The differentiator to land immediately: **parsed, not hallucinated.**

### 6.7 Claims that would be misleading — **Verified as unsupported**
- Customer logos, testimonials, user counts, uptime, "X% faster", star counts —
  none exist in the repo.
- Any performance benchmark, "supports N languages", "handles repos of size X" —
  no such claim is supported; scope is **TypeScript/JavaScript only**, public
  repos only, one deployable.
- "AI analyzes your architecture" / "AI finds issues" — contradicts the entire
  product rule; the AI only explains/labels/looks up.
- "Private repositories", "GitLab/Bitbucket", "monorepo support", "IDE plugin",
  "CI integration" — not implemented.
- Any security-certification (SOC2 etc.), SSO/SAML enterprise claims — not
  present. (Clerk orgs + Supabase RLS exist; enterprise SSO is **Unknown**.)

---

## 7. Recommended landing page information architecture

Recommended sections, each justified by a verified capability. Not all are
mandatory; a focused page could ship hero + how-it-works + three capabilities +
CTA.

1. **Top nav** — wordmark "Cartograph" (reuse `font-display`), a "Sign in" link,
   and a primary "Map a repository" button. *Why:* the only authenticated entry
   is sign-in; there is no public app surface, so the nav must route to Clerk.
2. **Hero** — headline around *"See the shape of a codebase you didn't write."*
   Subcopy names the differentiator: **every line comes from really parsing the
   code — the AI explains it, it never invents it.** Primary CTA "Map a public
   repository" (→ sign-up), secondary "See how it works" (anchor).
   *Capability:* public-repo parsing + the governing rule.
3. **Product UI preview** — a real screenshot of the map with the pane open (use
   `demo-image/*` once their content is confirmed, or capture fresh). *Why:* the
   map is the product; a genuine UI preview is the single most credible asset.
   Do **not** fabricate dashboard content.
4. **How it works** — the real five stages: Fetch → Select → Parse → Classify →
   Store (`analysis-progress.tsx`), then "read the map". *Capability:* the
   pipeline is real and named; showing it is honest.
5. **Core capabilities** (pick 3–4) — parsed-not-guessed edges + coverage;
   blast radius / dependency chain; grounded explanations; Ask with visible
   lookups. *Each maps to §6.4.*
6. **The dependency graph** — a dedicated look at folders-as-boxes →
   files-as-rows, directional amber/green edges, file-kind rail. *Capability:*
   the map itself.
7. **Ask, grounded in the graph** — show tool calls preceding the answer; state
   plainly the agent reads through read-only tools and cannot invent a path.
   *Capability:* Phase 12 agent + its boundaries.
8. **Security & access boundaries** — public repos only, no repo tokens stored;
   org-scoped analyses; RLS in the database. *Capability:* Clerk orgs + Supabase
   RLS. Keep claims to what exists (no SOC2/SSO/enterprise).
9. **Built for developers / use cases** — "I inherited an agent-built repo",
   "a dependency I'm afraid to touch", "onboarding a new teammate". *Why:*
   mirrors the verified personas in `docs/project-doc.md`.
10. **Final CTA + footer** — repeat "Map a public repository"; footer with
    wordmark, sign-in, and (only if they exist) real links. *No invented social
    links.*

**Sections to avoid or handle carefully:** testimonials/logos (none), pricing
(no pricing exists — **Unknown**), integrations (none), "trusted by" (none),
status/uptime (none).

---

## 8. Proposed implementation plan (options, not decisions)

### 8.1 The core routing problem
Today `/` is the authenticated dashboard (`app/(app)/page.tsx`) and `proxy.ts`
protects it. A public landing page must be reachable **signed-out** without
breaking that.

**Option A — marketing route group, `/` becomes public.**
- Move the dashboard off `/` (e.g. to `/runs` or `/dashboard`) and add a public
  `app/(marketing)/page.tsx` at `/`. Add `/` to `publicRoutes` in `proxy.ts`,
  and make the landing page itself branch on `auth()`: signed-in → redirect to
  the dashboard; signed-out → render marketing.
- **Pros:** cleanest URLs; `/` is the canonical marketing home.
- **Cons:** touches `proxy.ts` and moves a protected route; more surface to get
  wrong. Must keep `auth.protect()` on the moved dashboard.

**Option B — a dedicated public path (e.g. `/welcome` or `/home`).**
- Add a public route in its own group and add it to `publicRoutes`; leave `/` as
  the dashboard.
- **Pros:** smallest blast radius; dashboard untouched.
- **Cons:** `/` still shows the dashboard/login, so the "homepage" is not
  marketing-friendly; weaker for a real landing page.

**Option C — landing at `/` without moving the dashboard**, by making
`app/(app)/page.tsx` itself render marketing when signed-out.
- **Cons:** mixes two very different layouts in one authenticated shell; fights
  the settled `(app)/layout.tsx` header. **Not recommended.**

**Recommendation (with a caveat to confirm):** **Option A** if `/` is meant to be
the marketing home; otherwise **Option B**. This is a product decision the
codebase does not settle — **ask the user.**

### 8.2 Files that would be created / modified (Option A shown)
- **Create:** `app/(marketing)/page.tsx` (the landing page), a marketing layout
  `app/(marketing)/layout.tsx` (public chrome: nav + footer, *not* the `(app)`
  shell), and landing components under `components/landing/`.
- **Modify:** `proxy.ts` (add the chosen public path(s) to `publicRoutes`).
- **Move (Option A only):** `app/(app)/page.tsx` → a new protected path; update
  links to it (`app/(app)/analyses/[id]/page.tsx:47` "← Runs", header wordmark,
  `actions.ts` redirect targets, `sign-in` fallback redirects).
- **Do not touch:** `app/(app)/layout.tsx` shell semantics, the parser, the
  pipeline, the agent, the DB, `lib/env.ts`.
- **Reuse:** design tokens in `app/globals.css`, fonts in `app/layout.tsx`,
  `ThemeToggle`, and the *visual concept* of `RepoForm` (not the component, which
  requires an org).

### 8.3 Preserving the authenticated app
- Keep `auth.protect()` in `app/(app)/layout.tsx` and per-page checks; the proxy
  is an *early* redirect only (`proxy.ts:6`, `layout.tsx` comment).
- Sign-in/up fallback redirects (Clerk) must point at the new dashboard path if
  Option A moves it. **Risk of breaking auth here — see §9.**
- The landing page, if it branches on auth, must await `auth()` server-side and
  `redirect()` signed-in users, matching the app's "no flash of wrong UI" style.

### 8.4 Responsive + no new dependencies
- Tailwind v4 already present; build the landing with utility classes + existing
  tokens. **No new packages** (project rule: don't install without asking —
  `CLAUDE.md:113`). The current app is desktop-first (fixed 3 columns); the
  landing page is the first place mobile layout genuinely matters.

### 8.5 Reuse real UI, not fake dashboards
- Prefer screenshots of the real workspace (`demo-image/*` exist — verify their
  content first) or a static, honest reproduction using real token colours.
  Never mock metrics/panels that the product does not have.

### 8.6 SEO / a11y / performance / reduced-motion
- `metadata` currently lives in `app/layout.tsx:21` (title "Cartograph",
  description "Map a codebase from the code itself"). A landing page may set its
  own `metadata`/OpenGraph — **no OG image or favicon beyond `app/favicon.ico`
  exists (Verified)**.
- A11y conventions are present in the app (`aria-pressed`, `role="alert"`,
  `aria-label`, `aria-expanded`) — follow them. Colour pairs must keep contrast.
- The product rule "**Nothing moves on its own**" (`docs/project-doc.md`) is a
  strong signal: a landing page should avoid ambient animation; respect
  `prefers-reduced-motion` if any motion is used.

---

## 9. Authentication and routing considerations

- **`proxy.ts` is the gate.** Adding a public landing route means editing
  `publicRoutes` (regex array). Forgetting to protect a new *authed* path is the
  symmetric risk.
- **The `(app)` layout wraps all protected pages.** A marketing layout must be a
  *separate* route group so the app header (org switcher, user button) never
  renders for anonymous visitors.
- **Clerk redirects.** `proxy.ts` uses `redirectToSignIn({ returnBackUrl })`;
  Clerk components use fallback redirects. If the dashboard moves (Option A),
  update every `href="/"` and any Clerk `*RedirectUrl` so users land back on the
  dashboard, not the marketing page. Grep targets: `href="/"` in
  `app/(app)/layout.tsx` and `app/(app)/analyses/[id]/page.tsx`;
  `afterSelectOrganizationUrl` / `afterCreateOrganizationUrl` in
  `app/(app)/layout.tsx:36`.
- **Second risk:** `lib/env.ts` `REQUIRED_ENV` fails startup if Clerk/Supabase
  public vars are missing (`instrumentation.ts`). A landing page still boots
  inside that process, so preview environments need those vars set — do **not**
  print or commit them.
- **Org-less users:** `app/(app)/page.tsx:40` handles "no workspace selected".
  The landing CTA should route into sign-up, which (per the sign-up page
  comment) auto-creates an org.

---

## 10. Testing and acceptance checklist (for the eventual landing task)

Terminal-verifiable (the implementer should run these):
- [ ] `npx tsc --noEmit` — 0 errors.
- [ ] `npx eslint .` — 0 problems.
- [ ] `npx next build` — compiles; the new route appears in the build's route
      list as a public page.

Browser acceptance (owner-run; landing task must not automate it):
- [ ] Signed-out visit to the landing route renders marketing, not a redirect.
- [ ] Signed-in visit to the landing route goes to the dashboard (or stays, per
      chosen option) without a flash of the wrong screen.
- [ ] Sign-in → org → dashboard flow still works; signing out returns to a
      sensible page.
- [ ] No app header (org switcher / user button) leaks onto the marketing page.
- [ ] Light/dark/system all render with correct contrast; reduced-motion
      respected.
- [ ] Mobile/narrow widths lay out without horizontal scroll.

---

## 11. Risks, unknowns, unsupported claims

**Risks**
- Moving `/` (Option A) risks breaking auth redirects and existing links.
  Mitigate by grepping all `href="/"` and Clerk redirect props.
- Making a protected path public by accident in `proxy.ts` would expose
  dashboard routes.
- The `(app)` shell uses `h-dvh` + internal scrolling (`app/(app)/layout.tsx`);
  a marketing page must not inherit that fixed-height behaviour — keep it in its
  own layout.
- Coupling the landing page to `RepoForm` would drag auth/org requirements onto a
  public page — keep it visual-only.
- `demo-image/*.png` content is unverified; confirm before publishing.

**Unknowns**
- Deployment target and preview env (no config found).
- Whether `demo-image` screenshots are current or current-looking enough to use.
- Pricing / business model (no evidence).
- Whether enterprise SSO / any compliance posture exists (no evidence).

**Must not change during the landing task**
- Parser/pipeline/agent/DB code, RLS policies, `lib/env.ts` contract.
- The `(app)` authenticated shell's settled structure.
- Existing auth behaviour and the semantics of `proxy.ts` for existing routes.

**Must not fabricate**
- Logos, testimonials, metrics, benchmarks, integrations, language support beyond
  TS/JS, private-repo support, or any "AI finds issues/scores code" claim.

---

## 12. Handoff brief for the next AI assistant

You are adding **the first public landing page** to **Cartograph**, an existing
Next.js 16 / React 19 / TypeScript / Tailwind v4 app. You do **not** have the
repo, so read this whole brief; where it says a file matters, ask the user to
paste it before editing.

**What Cartograph is.** Sign in (Clerk), paste a public GitHub TS/JS repo URL,
get an interactive dependency map. Folders are boxes, files are rows inside them,
imports are directional edges (amber = outgoing, green = incoming). A right-hand
pane has tabs **Structure / Routes / Explanation** and a fourth **Ask** mode.
The unbreakable rule: *every box and line comes from really parsing the code* —
the AI only explains, labels, and looks facts up through read-only tools; it
never decides an edge and never walks the graph itself. It is a **map, not a
reviewer**: no scores, no severity, no "issues found".

**Audience.** A developer opening a codebase they didn't write (often
agent-built over many sessions), and small teams inheriting such code. They can
read code; they can't see its shape.

**Current state you must respect.** `/` is today the **authenticated dashboard**
(`app/(app)/page.tsx`) and is protected by `proxy.ts`, which makes only
`/sign-in`, `/sign-up`, `/__clerk` public. There is **no public page at all**.
Any real "homepage" work therefore has a routing decision to resolve first
(§8.1) — **ask the user** whether `/` should become the marketing home (Option A)
or whether the landing lives at a new public path (Option B). Do not silently
move the dashboard.

**Stack facts.** App Router; Tailwind v4; tokens in `app/globals.css` as
`light-dark()` values (`--surface/--raised/--border/--text/--muted`, accent blue,
incoming green, outgoing amber, six file-kind hues); fonts Geist / Geist Mono /
Space Grotesk via `next/font`. Reuse tokens and fonts; a `ThemeToggle` exists and
is reusable. Do **not** add dependencies (project rule). The product UI is a
dense 13px developer tool — the landing page needs its own, more generous visual
language while staying in the same palette.

**Build guidance.** Public page = its own route group with its own layout (never
the `(app)` shell). Recommended sections in order: nav (wordmark, Sign in, "Map a
repository"); hero (headline about seeing a codebase's shape; subcopy: parsed,
never invented; CTA → sign-up); real product screenshot; how-it-works (Fetch →
Select → Parse → Classify → Store); 3–4 core capabilities (parsed edges +
coverage; blast radius / dependency chain; grounded explanations; Ask with
visible tool lookups); dependency-graph explainer; Ask-grounded-in-graph;
security boundaries (public repos only, no tokens stored, org-scoped, RLS);
developer use cases; final CTA + footer. Avoid motion (product rule: "nothing
moves on its own"); respect `prefers-reduced-motion`. Set proper
`metadata`/OpenGraph.

**Hard constraints.** Do not fabricate logos, testimonials, metrics, benchmarks,
or integrations. Do not claim languages beyond TS/JS, private repos, or any
AI-review/score feature. Do not touch the parser, pipeline, agent, DB, RLS, the
`(app)` shell semantics, or existing auth behaviour. Do not print secrets/env
values. Keep the signed-in experience working; update every Clerk redirect and
`href="/"` if the dashboard moves. Verify with `tsc --noEmit`, `eslint`, and
`next build`; leave the browser acceptance check to the user.

---

## 13. Open questions for the user

1. **Routing:** should `/` become the public landing page (moving the dashboard),
   or should the landing live at a new public path with `/` unchanged? (§8.1)
2. **Screenshots:** may the `demo-image/*.png` files be used, and are they
   current? (Their content could not be read by this model.)
3. **Deployment/preview:** where does this run, and what public env vars are set
   for previews? (No deployment config found.)
4. **Business model / pricing:** does any pricing or plan exist to reference?
5. **Brand:** is "Cartograph" the final name and is there a logo/wordmark beyond
   the Space Grotesk text wordmark?
