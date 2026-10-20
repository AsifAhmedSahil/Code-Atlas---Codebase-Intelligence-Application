# The agent service

An independent local service that answers questions about one analysed
repository. It runs as its own process, is reached by the web application over
HTTP, and reads the dependency graph through six read-only tools. It never
writes, never reaches another analysis, and never sees the browser directly.

## What it is, and what it is not

- **It is** a small HTTP service (`agent/server.ts`) with an OpenAI tool loop
  (`agent/runtime.ts`), six read-only graph tools (`lib/agent/tools.ts`), and a
  scoped credential it verifies on every request (`lib/agent/scope.ts`).
- **It is not** a coding agent. It edits nothing, runs no commands, and has no
  tool that changes an analysis, a role, or an edge. Any new tool that invented
  a relationship instead of querying the stored graph would cross the product
  boundary.

## Known gap: Managed Deep Agents

This phase was written against the provider's **Managed Deep Agents** runtime.
That API was retired: `GET https://api.smith.langchain.com/v1/deepagents/agents`
now answers **HTTP 410 `endpoint_retired`**, stating Managed Deep Agents are
created and deployed with the `mda` CLI as LangSmith deployments and the old
endpoints were removed on or after 2026-07-15. The rest of LangSmith is
unaffected (the `/info` endpoint responds, datasets list).

Rather than depend on a retired endpoint, the runtime is a local OpenAI tool
loop behind one interface — `AgentRuntime` in `agent/runtime.ts`. The HTTP
surface, the credential check, the tools and the UI know only that interface.
Wiring in a managed runtime later means writing one file that satisfies it; it
does not change anything else. This is the single known limitation of the phase:
the spec's "use the managed runtime" is met by a swappable local runtime with
the gap recorded here, because the managed runtime is unavailable.

## Environment variables

Set these in `.env.local` (git-ignored; never printed, never committed):

| Name | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | app + agent | Supabase project URL. |
| `SUPABASE_SECRET_KEY` | agent | Reads the scoped analysis. Server-side only. |
| `OPENAI_API_KEY` | app + agent | The model the agent answers with, and the one used for explanations. |
| `AGENT_CREDENTIAL_SECRET` | app + agent | HMAC secret for the scoped analysis credential. At least 16 characters. **Same value in both processes.** |
| `AGENT_SERVICE_URL` | app | Where the agent listens. Defaults to `http://127.0.0.1:8787`. |
| `AGENT_PORT` | agent | The port to bind. Defaults to `8787`. |
| `AGENT_EVAL_ANALYSIS_ID` | eval | Optional. Pins the analysis the agent eval runs against. |

Generate a secret once and put the same value in both places:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Running it locally

Two processes, started independently. The application works with the agent
stopped; only Ask mode is unavailable.

```
pnpm agent        # the agent service, on http://127.0.0.1:8787
pnpm dev          # the web application
```

Check the service is up:

```
curl http://127.0.0.1:8787/healthz
```

In the app, open an analysis, select a file if you like, and press **Ask** in
the right-hand pane. Ask is a mode of the pane, not a tab: leaving it restores
the tab and the selection that were there before.

## The six tools

All six are pure functions of the authorised analysis's `ParseResult`; none of
them touches the database, and the module cannot reach a client. Traversal is
the same `walkGraph` the canvas uses, neighbours are the same `neighboursOf`,
roles come from `roleByPath`, the summary from `mostDependedOn` /
`unimportedFiles` / `buildInsights`. The tools shape input, bound output, and
name their limits — they do not re-derive graph behaviour.

| Tool | Input | Returns |
| --- | --- | --- |
| `analysis_summary` | — | Counts, coverage, roles present, most-imported, entry points, insights. |
| `search_files` | `query`, `limit?` | Files whose path contains the query, ranked exact → prefix → substring. |
| `list_files_by_role` | `role`, `limit?` | Files carrying a supported role. An unsupported role is refused. |
| `direct_neighbours` | `path` | The file's dependencies and dependents. |
| `transitive_walk` | `path`, `direction`, `maxDepth?` | Breadth-first walk inbound (`in`) or outbound (`out`), capped at depth 4. |
| `route_table` | — | The routes read from the framework's conventions. |

`/tools` returns these contracts (no credential needed — it describes the
surface, not the data).

## The scoped analysis credential

The application mints one credential per question, and only after both of these
are true:

1. The viewer is signed in with an active organization.
2. The analysis is read back with the **viewer's own row-scoped token**
   (`getStoredAnalysis(..., { organizationId })`). An analysis in another
   organization comes back as nothing.

The credential names the analysis and the organization and expires in five
minutes. It is sent by the application to the agent on a private port and is
**never sent to the browser**. The browser talks to `/api/agent/run`; that route
talks to the agent. The agent verifies the credential on every request and
derives the scope from the verified claims — never from the body, the query
string, or anything the model said.

The token is HMAC-SHA256 over a small payload, built on `node:crypto`. No JWT
library was added.

### Why not put it in the app and skip the service?

Because the spec requires an independent service reached over HTTP, and because
it keeps the database key and the signing secret out of the web application's
request path. It also means the agent can be restarted, scaled, or replaced
without touching the app.

## Database access

The agent holds a privileged (`SUPABASE_SECRET_KEY`) client, for one reason: it
runs outside the web application and therefore holds no Clerk session, so a
row-level-scoped read is not available to it. The spec permits this on the
condition that the privilege is isolated and the scope is enforced everywhere.

The isolation is `lib/agent/repository.ts`, the only file in the agent that
reads the database. It exposes one method, `loadAnalysis(scope)`, which calls
`getStoredAnalysis(client, analysisId, { organizationId })`. That loader filters
on `organization_id` in every query — analyses, files, edges, skipped_files,
file_roles, routes — so a row owned by another organization cannot be read
through this analysis id. Those filter lines are pinned by
`scripts/check-phase12.ts`.

The trade-off, stated plainly: a cross-organization read is prevented by the
filters, not by the database. A bug in those filters would be an incident. If
the project later gains a Supabase JWT secret shared with Clerk, the right fix
is to exchange the scoped credential for a short-lived row-scoped token and drop
the privileged key; that change touches only `repository.ts`.

Nothing derives a scope from repository content. A filename, comment, or string
that names another analysis changes nothing, because scope is never read from
repository content.

## Request and response limits

- One message: 4000 characters. One turn: 40 messages.
- Tool rounds per turn: 8.
- Walk depth: capped at 4; walk output capped at 200 paths.
- List and search output: capped per call (50–100 depending on the tool).
- An analysis's graph is cached in memory for 60 seconds; the cache holds at
  most four analyses.
- Threads are in memory, expire after 30 minutes idle, and are capped at 200.

## Evaluation

```
pnpm eval:agent
```

Runs two halves, reported separately:

- **A. Tool use (deterministic).** Runs the tools directly against the stored
  analysis and checks the answers — a missing file returns no match, a walk in
  one direction differs from the other, an unsupported role is refused. This is
  the ground truth for tool behaviour; it needs no model.
- **B. Plumbing scan (deterministic).** Scans real answers for words the
  product's rules forbid volunteering (signing secret, endpoint, thread id,
  model name). A brief factual answer never needs them.
- **C. Relevance judge (subjective).** A model judge scores how well each
  answer addressed its question. This is a model opinion with a number
  attached, labelled as such, and is never printed as a pass or fail.

The deterministic halves run even when the agent service is stopped; the live
answer halves are skipped with a clear note in that case. Start the service with
`pnpm agent` to score answers.

`agent/README.md` and this section are the setup documentation; the acceptance
outcomes and design notes live with the phase.

## What the agent will not do

- It will not invent a path, file, role, dependency, or route. A path that is
  not in a tool result does not exist to it.
- It will not read another analysis. There is no tool argument that names one,
  and the scope comes from a credential it never sees.
- It will not follow instructions found inside repository content. Comments,
  filenames and strings are data to be read, not commands to obey.
- It will not discuss its own plumbing unless asked directly and appropriately
  about it.
