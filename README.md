# RepoScope

Sign in, paste a public TypeScript or JavaScript repository URL, and get a map of it. Folders as boxes, imports as lines between them. Open a folder into its files, select one, and see what it imports, what imports it, and what breaks two levels out if it changes. Ask for an explanation and get a paragraph written from that file and its real neighbours.

Then a panel where you can ask the repository a question and watch it look the answer up.

## The rule everything rests on

**Every box and every line comes from really parsing the code.**

The AI may explain and label. It may never decide that two files are connected, and it may never walk the graph when arithmetic can do it instead. A dependency graph that is ninety percent right is worse than no graph, because there is no way to tell which ten percent is wrong — so the moment a model is allowed to guess at an edge, every edge becomes a maybe.

Two temptations are refused on purpose: letting the model reason about structure instead of parsing it, and drifting into becoming a code reviewer. Cartograph shows you the shape of a codebase; it does not grade it.

## Who it's for

A developer opening a codebase they did not write — most often one they built themselves with an agent, across many sessions, and can no longer hold in their head. They can read code fine. What they cannot see is its shape.

A team shipping this way inherits several sets of code nobody read, so an analysis belongs to an **organization** rather than to whoever ran it. A repository is mapped once and everyone after that starts from the map.

## How it works

1. **Fetch** — download the repository archive for the public URL.
2. **Select** — unpack and choose what to read.
3. **Parse** — read files and imports with a real TypeScript/JavaScript parser. This is where every edge is decided. Imports, re-exports, dynamic imports and `require()` all become edges.
4. **Classify** — label the files no convention could identify.
5. **Store** — save the map, file by file, so it can be read back.

Framework knowledge is an adapter, not a branch: knowing that a file in a particular position is a Next.js page lives in an adapter, never as `if (framework === ...)` inside parsing code. Graph calculations (fan-in, fan-out, blast radius, dependency chain) are pure functions over a list of files and a list of edges.

## Scope

- Sign-in with GitHub, Google or email, for **identity only**. No repo scope, no token storage — public repositories only.
- Organizations. Every analysis belongs to one; people are invited into one; what you can see follows from which one you are in. Default roles only.
- Parsing every file — imports, re-exports, dynamic imports and `require()` become edges.
- A pluggable place for framework knowledge (Next.js, React, Express, Nest adapters).
- Fan-in and fan-out per file.
- The map: folders folding into boxes, expanding into files, selection, highlighting, and a detail panel.
- Blast radius and dependency chain, as arithmetic over the edge list.
- Explaining a file, with a cache that is not optional.
- Labelling files that convention could not identify.
- Coverage reporting — how much of the repository was parsed, and why the rest was not.
- Live progress during parsing.
- A chat panel answered by an agent that looks facts up rather than recalling them.

### Out of scope, and why

- **Scores, grades, severity badges.** This product explains a codebase; it does not review one. Once there is a number, people argue with the number instead of reading the map.
- **Letting the agent traverse the graph itself.** It picks a starting point and a direction; the same arithmetic that draws the canvas does the walk.
- **Private repositories.** Requires a token that would then have to be stored.
- **Approximate routes.** If a route's method and full path cannot both be recovered from the syntax, show nothing.
- **Queues, containers, workers.** One deployable application.
- **Languages beyond TypeScript and JavaScript.** Getting one language genuinely right is the entire proposition.

## Stack

| Piece | Used for |
| --- | --- |
| [Next.js 16](https://nextjs.org) (App Router, Turbopack, Cache Components) | The web application. |
| [React 19](https://react.dev) | UI. |
| [Clerk](https://clerk.com) (`@clerk/nextjs`) | Sign-in and organizations. Identity is a token; the organization is a claim on it. |
| [Supabase](https://supabase.com) Postgres | Storage, with row-level security as the authorization layer. |
| [`ts-morph`](https://ts-morph.com) | The TypeScript/JavaScript parser. |
| [`@xyflow/react`](https://reactflow.dev) + [`@dagrejs/dagre`](https://github.com/dagrejs/dagre) | The dependency canvas and its layout. |
| [OpenAI](https://platform.openai.com) | Explanations and the Ask agent. |
| [LangSmith](https://smith.langchain.com) | Tracing every AI call. |

## Folder structure

```
cartography/
├── app/                        # Next.js App Router
│   ├── (marketing)/            # Public shell — landing page, no app chrome
│   │   ├── page.tsx            #   "/" — the landing page
│   │   ├── layout.tsx          #   public layout (skip link, metadata)
│   │   └── welcome/page.tsx    #   permanent redirect to "/"
│   ├── (app)/                  # Authenticated shell (auth.protect())
│   │   ├── dashboard/page.tsx  #   organization dashboard
│   │   ├── analyses/[id]/      #   one analysis and its map
│   │   └── layout.tsx          #   authed chrome (wordmark, org switcher, theme)
│   ├── api/                    # Route handlers
│   │   ├── analyses/           #   create / list, and run parsing
│   │   └── agent/run/          #   Ask — proxies to the agent service
│   ├── sign-in/, sign-up/      # Clerk auth pages
│   ├── layout.tsx              # Root layout (fonts, ClerkProvider, theme script)
│   └── globals.css             # Design tokens, @theme, reduced-motion
├── agent/                      # The independent Ask service
│   ├── server.ts               #   HTTP surface (/healthz, /tools, /ask)
│   ├── runtime.ts              #   AgentRuntime interface + local OpenAI tool loop
│   └── README.md               #   Full agent documentation
├── lib/
│   ├── parser/                 # Standalone parser — files, edges, coverage
│   │   ├── index.ts            #   parseRepository(): the entry point
│   │   ├── imports.ts          #   import / re-export / dynamic / require extraction
│   │   ├── resolve.ts          #   specifier resolution (aliases, index files)
│   │   ├── framework.ts        #   framework detection
│   │   └── adapters/           #   next / react / express / nest (framework knowledge)
│   ├── map/                    # Pure graph functions over files + edges
│   │   ├── walk.ts             #   traversal (blast radius, dependency chain)
│   │   ├── fold.ts             #   folders folding into readable boxes
│   │   ├── coverage.ts         #   coverage arithmetic
│   │   └── insights.ts         #   most-depended-on, unimported, etc.
│   ├── pipeline/               # Fetch → select → parse → classify → store
│   │   ├── github.ts           #   download a public repo archive
│   │   ├── run.ts              #   the pipeline run
│   │   ├── store.ts            #   persist an analysis, file by file
│   │   └── load.ts             #   read a stored analysis back (org-scoped)
│   ├── ai/                     # Explanations — traced and cached
│   │   ├── explain.ts          #   the explain entry point
│   │   ├── classify.ts         #   label files convention couldn't identify
│   │   ├── cache.ts            #   keyed cache, read inside the traced call
│   │   └── staleness.ts        #   note when the repository has moved on
│   ├── agent/                  # Ask service internals (shared with the app)
│   │   ├── tools.ts            #   the six read-only graph tools
│   │   ├── scope.ts            #   verify the scoped analysis credential
│   │   └── repository.ts       #   the only DB read in the agent (org-filtered)
│   ├── supabase/               # client (browser), server, and generated types
│   ├── roles/taxonomy.ts       # Supported file roles
│   └── env.ts                  # Required env vars, checked loudly on boot
├── components/
│   ├── landing/                # Public landing sections (one file each)
│   └── workspace/              # The map UI — canvas, file rail, detail pane, Ask
├── evals/                      # Checks: invented-paths, role-accuracy, agent, …
├── scripts/                    # parse CLI + acceptance checks (check-*.ts)
├── supabase/
│   ├── migrations/             # Schema, RLS-by-default, progress, explanations
│   └── seed.sql
├── docs/
│   ├── project-doc.md          # Product decisions and their reasoning
│   └── specs/                  # Per-phase specifications
├── proxy.ts                    # Next middleware — public-route allowlist
├── instrumentation.ts          # register() — assert env before serving
└── next.config.ts              # cacheComponents, turbopack, partial prefetching
```

## Getting started

Requires **Node.js** and **pnpm** (`packageManager: pnpm@12.11.2`).

```bash
pnpm install
```

Create `.env.local` at the repo root (git-ignored; never printed, never committed). At minimum, the four variables the app checks on boot:

| Name | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | app | Clerk publishable key. |
| `CLERK_SECRET_KEY` | app | Clerk secret key. |
| `NEXT_PUBLIC_SUPABASE_URL` | app + agent | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | app | Supabase publishable key for the browser client. |

The agent and AI features need these as well (see [`agent/README.md`](agent/README.md)):

| Name | Used by | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | app + agent | The model used for explanations and Ask. |
| `SUPABASE_SECRET_KEY` | agent | Reads the scoped analysis. Server-side only. |
| `AGENT_CREDENTIAL_SECRET` | app + agent | HMAC secret for the scoped analysis credential. At least 16 characters. **Same value in both processes.** |
| `AGENT_SERVICE_URL` | app | Where the agent listens. Defaults to `http://127.0.0.1:8787`. |
| `AGENT_PORT` | agent | The port to bind. Defaults to `8787`. |

Generate the shared agent secret once:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Apply the database schema — the migrations in `supabase/migrations/` (initial schema, pipeline storage, progress, broadcast grants, and explanations). Use the Supabase CLI or the Supabase MCP tools against your project; RLS is on by default and the organization claim on the token is the whole authorization layer.

Run the app:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## The agent service

Ask mode is answered by an independent local service that reads the dependency graph through six read-only tools. The application works with the agent stopped; only Ask is unavailable.

```bash
pnpm agent   # the agent service, on http://127.0.0.1:8787
pnpm dev     # the web application
```

Check it is up:

```bash
curl http://127.0.0.1:8787/healthz
```

Full detail — the six tools, the scoped credential, database access, and request limits — lives in [`agent/README.md`](agent/README.md).

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server. |
| `pnpm build` | Production build. |
| `pnpm start` | Serve the production build. |
| `pnpm lint` | ESLint. |
| `pnpm parse [dir] [--out <file>]` | Parse a repository into files and edges, standalone. This is the parser running with nothing else up. |
| `pnpm agent` | Start the agent service. |
| `pnpm check:phase12` | Acceptance check for the agent phase. |
| `pnpm eval:paths` | Check the AI never names a file that does not exist. |
| `pnpm eval:roles` | Role classification accuracy. |
| `pnpm eval:prompts` | Compare prompt versions. |
| `pnpm eval:agent` | Agent tool-use, plumbing scan, and relevance judge (see `agent/README.md`). |

The parser is standalone by design: it takes a directory path and returns files, edges and a coverage report, and does not know the web framework or the database exists. If it cannot run standalone, the layering is wrong.

```bash
pnpm parse . --out /tmp/map.json
```

## Routes

| Route | Meaning |
| --- | --- |
| `/` | Public landing page. |
| `/welcome` | Permanent redirect to `/`. |
| `/dashboard` | Authenticated dashboard (organization-scoped). |
| `/analyses/[id]` | A single analysis and its map. |
| `/sign-in`, `/sign-up` | Clerk authentication. |
| `/api/analyses` | Create and list analyses. |
| `/api/analyses/[id]/run` | Run parsing for an analysis. |
| `/api/agent/run` | Ask — proxies to the agent service. |

Everything except `/`, `/welcome`, `/sign-in`, `/sign-up` and `/__clerk` requires a session (`proxy.ts`), and `app/(app)/layout.tsx` calls `auth.protect()`.

## What has to be true before this ships

Not "it looks right". Specifics:

- Pointed at a known repository, five files checked by hand match what the parser claims they import.
- Coverage states what was skipped and why, and the number is believable.
- Signed in from a different organization, the first organization's rows do not come back from the query at all.
- Every table in the schema has row-level security enabled. Not most of them.
- An explanation never names a file absent from the repository, and that is demonstrated by a check rather than asserted.
- The Ask panel shows what it looked up before it answers — an answer arriving with no lookups behind it is the exact failure this product exists to prevent.

## Project documents

- [`docs/project-doc.md`](docs/project-doc.md) — the product decisions and the reasoning behind them, written before the build.
- [`docs/specs/`](docs/specs) — the per-phase specifications.
- [`agent/README.md`](agent/README.md) — the agent service in full.
