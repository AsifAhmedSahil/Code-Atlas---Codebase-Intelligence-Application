// The one place the agent's service reads the database, and the narrowest
// possible one.
//
// Why a privileged credential exists at all: the agent runs as its own process,
// outside the web application, so it holds no Clerk session and no row-scoped
// token. Every read has to be authenticated somehow. The alternative — the
// application pre-loading the analysis and handing the agent a snapshot — would
// leave the agent with no database credential, but it also means the agent can
// only ever see what the application chose to send, and the tool surface stops
// reading an analysis of its own. The spec permits the privileged path on the
// condition that it is isolated and the scope is enforced on every query, so
// that is what this module is.
//
// The safety argument, in full:
//
// 1. Scope comes from a verified credential, never from the model. The agent
//    service resolves the credential before this module is called and passes the
//    claims through; no tool argument reaches it.
// 2. Every query — analyses, files, edges, skipped_files, file_roles, routes —
//    filters on both `analysis_id` and `organization_id`. A child row owned by
//    another organization cannot be read through this analysis id.
// 3. An analysis outside the scope is indistinguishable from one that does not
//    exist. The caller is never told the difference.
// 4. This module exposes one read and nothing else: no write, no RPC, no table
//    name is reachable from a tool.
// 5. The secret is read from the environment inside the agent process and is
//    never serialised into a response, a log line, or a model message. The
//    signing secret of the scoped credential lives here too and has the same
//    rule.
//
// The trade-off, stated plainly: the agent service is trusted with a credential
// that bypasses row-level security, because a cross-organization read is
// prevented by the filters above rather than by the database. A bug in those
// filters would be a real incident; the tests in `scripts/check-phase12.ts`
// pin the filter behaviour, and the agent process has no route that accepts an
// analysis id from anyone but the application. If the project ever gains a
// Supabase JWT secret shared with Clerk, the right fix is to make the agent
// exchange the scoped credential for a short-lived row-scoped token and drop
// the privileged key entirely; this module is the only file that would change.

import { existsSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { ParseResult } from "@/lib/parser/types";
import type { Database } from "@/lib/supabase/database.types";
import { getStoredAnalysis } from "@/lib/pipeline/load";

export interface AgentRepositoryScope {
  analysisId: string;
  organizationId: string;
}

export interface AgentRepository {
  // Resolves to the authorised analysis's graph, or null when the scope does
  // not cover it — the same answer as a missing analysis.
  loadAnalysis(scope: AgentRepositoryScope): Promise<ParseResult | null>;
  // Drops a cached analysis, so a test or a re-analysis never reads a stale map.
  invalidate(scope: AgentRepositoryScope): void;
}

export interface AgentRepositoryOptions {
  url: string;
  secretKey: string;
  // How long one analysis's graph stays hot. A conversation is minutes, not
  // hours, so the window is short enough that a re-analysis is picked up
  // without a restart and long enough that tool calls are pure memory.
  cacheTtlMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 60_000;
// A large repository is tens of thousands of files. Keeping a handful of
// analyses in memory bounds the process, and a conversation only ever touches
// one.
const MAX_CACHED_ANALYSES = 4;

interface CacheEntry {
  result: ParseResult | null;
  expiresAt: number;
}

export function createAgentRepository(options: AgentRepositoryOptions): AgentRepository {
  const client = createClient<Database>(options.url, options.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cache = new Map<string, CacheEntry>();
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  return {
    async loadAnalysis(scope) {
      const key = `${scope.organizationId}:${scope.analysisId}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.result;

      // The only query the agent ever issues. `getStoredAnalysis` applies the
      // organization filter to this read and to every child read it makes.
      const stored = await getStoredAnalysis(client, scope.analysisId, {
        organizationId: scope.organizationId,
      });
      const result = stored?.result ?? null;

      if (cache.size >= MAX_CACHED_ANALYSES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { result, expiresAt: Date.now() + ttl });
      return result;
    },

    invalidate(scope) {
      cache.delete(`${scope.organizationId}:${scope.analysisId}`);
    },
  };
}

// Reads `.env.local` so the agent process can be started on its own, the same
// way the eval scripts are. Silent when the file is absent, so a caller that
// has already exported the variables still runs.
export function loadAgentEnv(file = ".env.local"): void {
  const resolved = path.resolve(process.cwd(), file);
  if (!existsSync(resolved)) return;
  process.loadEnvFile(resolved);
}

export interface AgentServiceEnv {
  // Supabase, for the scoped reads above.
  supabaseUrl: string;
  secretKey: string;
  // The model the agent answers with, read from the application's own client
  // module so there is one AI client and one pinned model name in the repo.
  openAiApiKey: string;
  // Signs the scoped analysis credential. Shared with the web application.
  credentialSecret: string;
  // Where the agent service listens. The web application is the only client.
  agentServiceUrl: string;
  port: number;
}

export class AgentEnvError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(
      `The agent service is missing: ${missing.join(", ")}. ` +
        `Set them in .env.local — see agent/README.md.`,
    );
    this.name = "AgentEnvError";
    this.missing = missing;
  }
}

export function requireAgentEnv(env: NodeJS.ProcessEnv = process.env): AgentServiceEnv {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "OPENAI_API_KEY",
    "AGENT_CREDENTIAL_SECRET",
  ] as const;
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new AgentEnvError(missing);

  const port = Number(env.AGENT_PORT ?? 8787);
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL as string,
    secretKey: env.SUPABASE_SECRET_KEY as string,
    openAiApiKey: env.OPENAI_API_KEY as string,
    credentialSecret: env.AGENT_CREDENTIAL_SECRET as string,
    agentServiceUrl: env.AGENT_SERVICE_URL?.trim() || `http://127.0.0.1:${port}`,
    port: Number.isFinite(port) && port > 0 ? port : 8787,
  };
}
