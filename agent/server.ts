// The agent service: its own process, its own port, reached over HTTP.
//
// Four routes and nothing else. Every one that touches an analysis verifies a
// scoped credential first, and derives the analysis and organization from the
// verified claims — never from the body, the query string, or anything the
// model said. There is no route that accepts an analysis id.
//
// What this service deliberately does not have:
//
// - No browser-facing story. It is reached by the web application on the same
//   machine. In local development a browser could also reach the port directly,
//   which is a property of running things on localhost and not of this design;
//   `agent/README.md` records it. A deployment puts it behind a private network.
// - No write route, no delete route, no route that names a table.
// - No credential echo. Nothing logs a token, a signing secret, a database key,
//   or the content of a tool result.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import type { AgentChatMessage, AgentStreamEvent, AgentTurnRequest } from "@/lib/agent/conversation";
import { AGENT_INSTRUCTIONS } from "@/lib/agent/instructions";
import {
  AGENT_TOOL_NAMES,
  runAgentTool,
  TOOL_CONTRACTS,
  UnsupportedRoleError,
  UnknownPathError,
  type AgentToolName,
} from "@/lib/agent/tools";
import {
  createAgentRepository,
  loadAgentEnv,
  requireAgentEnv,
  type AgentRepository,
} from "@/lib/agent/repository";
import { verifyScopedCredential, type AgentScopeClaims } from "@/lib/agent/scope";
import type { AgentRuntime } from "@/agent/runtime";

// One message is a question, not a document. The cap keeps a single turn
// inside a bounded amount of model work and prevents a client from streaming a
// repository into a conversation.
export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_MESSAGES_PER_TURN = 40;
export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_SELECTED_PATH_CHARS = 512;

// Threads live in memory. A local service restarts; that is honest and it is
// also a bound: nothing accumulates across processes.
export const THREAD_IDLE_TTL_MS = 30 * 60 * 1000;
export const MAX_THREADS = 200;

export interface Thread {
  id: string;
  // The scope this thread was created under. Every turn must present a
  // credential naming the same scope, so a thread cannot be resumed across
  // analyses or across organizations.
  analysisId: string;
  organizationId: string;
  messages: AgentChatMessage[];
  lastTouchedAt: number;
}

export interface AgentServiceDeps {
  runtime: AgentRuntime;
  repository: AgentRepository;
  credentialSecret: string;
  // Injected so a test can supply a repository without a database.
  now?: () => number;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sse(res: ServerResponse): {
  send: (event: AgentStreamEvent) => void;
  close: () => void;
} {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    // The stream belongs to the application that opened it; no other origin
    // should be reading it.
    "x-accel-buffering": "no",
  });
  return {
    send(event) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    close() {
      res.end();
    },
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) return null;
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1] : null;
}

// Verifies the credential and returns its claims, or sends the rejection and
// returns null. The reason is logged; the response says only "not authorized",
// so a wrong signature and an expired token look the same from outside.
async function authorise(
  req: IncomingMessage,
  res: ServerResponse,
  secret: string,
): Promise<AgentScopeClaims | null> {
  const token = bearerToken(req);
  if (!token) {
    json(res, 401, { error: "not_authorized", message: "A scoped analysis credential is required." });
    return null;
  }
  const outcome = verifyScopedCredential({ token, secret });
  if (!outcome.ok) {
    // Observed, not echoed: the reason is for the operator's log.
    log(req, res, `credential rejected: ${outcome.reason}`);
    json(res, 401, { error: "not_authorized", message: "The credential is not valid." });
    return null;
  }
  return outcome.claims;
}

function log(req: IncomingMessage, res: ServerResponse, detail: string): void {
  // Method, path and a detail. Never a header, never a body, never a token.
  process.stdout.write(`${req.method ?? "?"} ${req.url ?? "?"} -> ${res.statusCode} ${detail}\n`);
}

function expireThreads(threads: Map<string, Thread>, now: number): void {
  for (const [id, thread] of threads) {
    if (now - thread.lastTouchedAt > THREAD_IDLE_TTL_MS) threads.delete(id);
  }
  while (threads.size > MAX_THREADS) {
    const oldest = threads.keys().next().value;
    if (oldest === undefined) break;
    threads.delete(oldest);
  }
}

// A question is text the reader typed. It may contain anything; it is never
// executed, never interpolated into a query, and never trusted as an
// instruction about scope.
function normaliseTurnRequest(body: unknown): { ok: true; value: AgentTurnRequest } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "The request body must be a JSON object." };
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "`messages` must be a non-empty array." };
  }
  if (messages.length > MAX_MESSAGES_PER_TURN) {
    return { ok: false, error: `A turn may carry at most ${MAX_MESSAGES_PER_TURN} messages.` };
  }

  const normalised: AgentChatMessage[] = [];
  for (const entry of messages) {
    if (!isRecord(entry)) return { ok: false, error: "Each message must be an object." };
    const role = entry.role;
    if (role !== "user" && role !== "assistant") {
      return { ok: false, error: "Each message must have role `user` or `assistant`." };
    }
    const content = entry.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      return { ok: false, error: "Each message must have non-empty string content." };
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return { ok: false, error: `A message may be at most ${MAX_MESSAGE_CHARS} characters.` };
    }
    normalised.push({ role, content: content.trim() });
  }

  const selectedPath = body.selectedPath;
  if (selectedPath !== undefined) {
    if (typeof selectedPath !== "string" || selectedPath.length > MAX_SELECTED_PATH_CHARS) {
      return { ok: false, error: "`selectedPath` must be a short string when present." };
    }
  }

  return {
    ok: true,
    value: {
      messages: normalised,
      ...(typeof selectedPath === "string" ? { selectedPath } : {}),
    },
  };
}

export interface AgentService {
  readonly port: number;
  close(): Promise<void>;
}

export function createAgentService(
  port: number,
  deps: AgentServiceDeps,
): Promise<AgentService> {
  const threads = new Map<string, Thread>();
  const now = deps.now ?? Date.now;

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      // A crash inside one request must not take the process down, and the
      // application relaying this stream must get a controlled error.
      const message = error instanceof Error ? error.message : "Unexpected error";
      if (!res.headersSent) json(res, 500, { error: "internal", message: "The agent service failed." });
      else {
        try {
          res.write(`data: ${JSON.stringify({ type: "error", message } satisfies AgentStreamEvent)}\n\n`);
          res.end();
        } catch {
          // The socket is already gone; nothing further to do.
        }
      }
      log(req, res, `unhandled: ${message}`);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const nowMs = now();
    expireThreads(threads, nowMs);

    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, { ok: true, runtime: deps.runtime.name, threads: threads.size });
      log(req, res, "ok");
      return;
    }

    // What the service is and what it will do. No credentials, no data, safe
    // to answer without a token because it describes the surface, not the
    // analysis.
    if (req.method === "GET" && url.pathname === "/tools") {
      json(res, 200, {
        instructions: "Read-only. Scope comes from the credential.",
        tools: TOOL_CONTRACTS,
      });
      log(req, res, "ok");
      return;
    }

    if (req.method === "POST" && url.pathname === "/tools/invoke") {
      const claims = await authorise(req, res, deps.credentialSecret);
      if (!claims) return;

      const body = await readJsonBody(req);
      if (body === null) {
        json(res, 400, { error: "bad_request", message: "The request body was not valid JSON." });
        return;
      }
      if (!isRecord(body) || typeof body.name !== "string") {
        json(res, 400, { error: "bad_request", message: "`name` is required." });
        return;
      }

      const analysis = await deps.repository.loadAnalysis({
        analysisId: claims.analysisId,
        organizationId: claims.organizationId,
      });
      if (!analysis) {
        // The same shape as a missing analysis: the caller is not told whether
        // the id exists elsewhere.
        json(res, 404, { error: "not_found", message: "No analysis is available for this credential." });
        return;
      }

      if (!(AGENT_TOOL_NAMES as readonly string[]).includes(body.name)) {
        json(res, 400, { error: "unknown_tool", message: `\`${body.name}\` is not one of the six tools.` });
        return;
      }

      try {
        const outcome = runAgentTool(analysis, body.name as AgentToolName, body.arguments ?? {});
        if (outcome.ok) json(res, 200, { ok: true, data: outcome.data });
        else json(res, 400, { ok: false, error: outcome.error });
        log(req, res, `tool ${body.name}: ${outcome.ok ? "ok" : "invalid"}`);
      } catch (error) {
        if (error instanceof UnknownPathError || error instanceof UnsupportedRoleError) {
          json(res, 400, { ok: false, error: error.message });
          log(req, res, `tool ${body.name}: contract error`);
          return;
        }
        throw error;
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/threads") {
      const claims = await authorise(req, res, deps.credentialSecret);
      if (!claims) return;
      const thread: Thread = {
        id: randomBytes(16).toString("hex"),
        analysisId: claims.analysisId,
        organizationId: claims.organizationId,
        messages: [],
        lastTouchedAt: nowMs,
      };
      threads.set(thread.id, thread);
      json(res, 201, { threadId: thread.id });
      log(req, res, "thread created");
      return;
    }

    const runMatch = /^\/threads\/([a-f0-9]{32})\/runs\/stream$/.exec(url.pathname);
    if (req.method === "POST" && runMatch) {
      const claims = await authorise(req, res, deps.credentialSecret);
      if (!claims) return;

      const thread = threads.get(runMatch[1]);
      // An unknown thread and a thread outside this credential's scope are the
      // same answer, so a thread id cannot be used to probe another scope.
      if (!thread || thread.analysisId !== claims.analysisId || thread.organizationId !== claims.organizationId) {
        json(res, 404, { error: "not_found", message: "No such conversation for this credential." });
        return;
      }

      const body = await readJsonBody(req);
      if (body === null) {
        json(res, 400, { error: "bad_request", message: "The request body was not valid JSON." });
        return;
      }
      const turn = normaliseTurnRequest(body);
      if (!turn.ok) {
        json(res, 400, { error: "bad_request", message: turn.error });
        return;
      }

      const analysis = await deps.repository.loadAnalysis({
        analysisId: claims.analysisId,
        organizationId: claims.organizationId,
      });
      if (!analysis) {
        json(res, 404, { error: "not_found", message: "No analysis is available for this credential." });
        return;
      }

      const stream = sse(res);
      try {
        // The thread's own history is the source of truth; the request's
        // messages are this turn's contribution, appended rather than
        // replacing what came before.
        for (const message of turn.value.messages) thread.messages.push(message);
        thread.lastTouchedAt = nowMs;

        let answer = "";
        await deps.runtime.stream(
          {
            analysis,
            history: thread.messages.slice(0, -turn.value.messages.length),
            userMessage: turn.value.messages[turn.value.messages.length - 1].content,
            ...(turn.value.selectedPath ? { selectedPath: turn.value.selectedPath } : {}),
          },
          async (event) => {
            if (event.type === "token") answer += event.text;
            stream.send(event);
          },
        );

        if (answer.trim()) {
          thread.messages.push({ role: "assistant", content: answer.trim() });
          // Bound the history a long thread can carry, keeping the oldest
          // turns out of the model's context rather than truncating a turn in
          // half.
          if (thread.messages.length > MAX_MESSAGES_PER_TURN) {
            thread.messages = thread.messages.slice(-MAX_MESSAGES_PER_TURN);
          }
        }
        log(req, res, `run complete (${answer.length} chars)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The agent failed.";
        // Logged for the operator; the stream gets a short, non-technical
        // sentence so the reader is not shown internals.
        log(req, res, `run failed: ${message}`);
        stream.send({ type: "error", message: "The agent could not finish that turn. Try again." });
      } finally {
        stream.close();
      }
      return;
    }

    json(res, 404, { error: "not_found", message: "Unknown route." });
    log(req, res, "not found");
  }

  return new Promise<AgentService>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      // `port` may be 0, asking the OS for a free port. The caller needs the
      // one that was actually bound, which is only known from the address.
      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        port: boundPort,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

// The application's AI client is wrapped for tracing, and its wrapper types the
// client loosely. The runtime needs one precisely-typed method, so this adapter
// states that shape once here rather than casting inside the loop. Every call
// still goes through the wrapped client, so agent turns are traced the same way
// the application's own model calls are.
async function tracedAgentClient(): Promise<import("@/agent/runtime").AgentChatClient> {
  const { aiClient } = await import("@/lib/ai/model");
  const traced = aiClient();
  // The tracing wrapper types the chat client loosely, so the streaming method
  // reads as optional. It is present on the real client; a missing one is a
  // mis-wired dependency, not something to work around silently.
  const stream = traced.chat.completions.stream;
  if (typeof stream !== "function") {
    throw new Error(
      "The AI client does not expose chat.completions.stream, so the agent cannot stream answers.",
    );
  }
  return {
    chat: {
      completions: {
        stream: (params) => stream.call(traced.chat.completions, params),
      },
    },
  };
}

// The process entry point. Kept separate from `createAgentService` so a test
// can build the service without binding a port.
export async function main(): Promise<void> {
  // The service is its own process, so nothing has loaded `.env.local` for it.
  // Loading it here (the way the eval scripts do) means `pnpm agent` just works
  // without a shell that pre-exports the variables.
  loadAgentEnv();
  const env = requireAgentEnv();
  const repository = createAgentRepository({
    url: env.supabaseUrl,
    secretKey: env.secretKey,
  });

  // The model name is the application's own pinned constant, so the repository
  // has one AI client and one model string in the whole repo.
  const { MODEL } = await import("@/lib/ai/model");
  const { createLocalRuntime } = await import("@/agent/runtime");

  const service = await createAgentService(env.port, {
    runtime: createLocalRuntime({
      apiKey: env.openAiApiKey,
      model: MODEL,
      client: await tracedAgentClient(),
    }),
    repository,
    credentialSecret: env.credentialSecret,
  });

  process.stdout.write(
    `agent service listening on http://127.0.0.1:${service.port}\n` +
      `runtime: local tool loop · model: ${MODEL}\n` +
      `instructions: ${AGENT_INSTRUCTIONS.length} characters\n`,
  );

  const shutdown = () => {
    void service.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /agent[\\/]server\.(ts|js|mts|mjs)$/.test(process.argv[1].replace(/\\/g, "/"));

if (invokedDirectly) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`agent service failed to start: ${message}\n`);
    process.exit(1);
  });
}
