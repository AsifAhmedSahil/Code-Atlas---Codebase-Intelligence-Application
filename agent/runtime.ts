// The agent's runtime: the loop that reads a question, calls tools, and writes
// an answer.
//
// This is the one module that could be replaced wholesale. The rest of the
// service knows only `AgentRuntime` — an input, an async stream of events, and
// nothing about how the answer was produced. Managed Deep Agents, the runtime
// this phase was written against, was retired by the provider on 2026-07-15 and
// is no longer reachable from this instance (the API answers 410), so the loop
// below is what runs. Swapping in a managed runtime later means writing one
// file that satisfies this interface; the HTTP surface, the credential check,
// the tools and the UI do not change. This limitation is recorded in
// `agent/README.md` and in the phase notes.
//
// The loop is bounded on purpose. A conversation is a few questions, not a
// session that runs all afternoon: tool rounds are capped, and a tool that
// fails is reported back to the model as a fact rather than thrown, because a
// wrong path is an answer, not an error.

import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import type { AgentStreamEvent, AgentChatMessage } from "@/lib/agent/conversation";
import { summariseToolResult } from "@/lib/agent/conversation";
import {
  AGENT_INSTRUCTIONS,
  AGENT_TOOL_DEFINITIONS,
  TOOL_PROGRESS_LABEL,
} from "@/lib/agent/instructions";
import {
  AGENT_TOOL_NAMES,
  runAgentTool,
  UnsupportedRoleError,
  UnknownPathError,
  type AgentToolName,
} from "@/lib/agent/tools";
import type { ParseResult } from "@/lib/parser/types";

// A question is a few rounds of looking things up. More than this and the
// answer is unlikely to improve, while the cost keeps climbing.
export const MAX_TOOL_ROUNDS = 8;

export type AgentRuntimeEvent = AgentStreamEvent;

export interface AgentTurnInput {
  // The authorised analysis. Resolved from the verified credential upstream;
  // the runtime cannot name another.
  analysis: ParseResult;
  // Prior turns in this thread, oldest first.
  history: readonly AgentChatMessage[];
  userMessage: string;
  // What the reader had selected on the map, if anything.
  selectedPath?: string;
}

export interface AgentRuntime {
  readonly name: string;
  stream(input: AgentTurnInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void>;
}

// The narrow slice of a chat client this loop needs. Typed structurally so the
// application's already-wrapped client — the one `lib/ai/model.ts` builds, with
// tracing applied to every call — can be handed straight in without a cast.
// `chat.completions.stream` is the streaming entry point on this SDK version;
// the `beta` namespace carries assistants and threads, not chat completions.
export interface AgentChatClient {
  chat: {
    completions: {
      stream(params: ChatCompletionCreateParamsStreaming): AsyncIterable<ChatCompletionChunk>;
    };
  };
}

export interface LocalRuntimeOptions {
  apiKey: string;
  model: string;
  // Injected so a test can drive the loop without a network call, and so the
  // service can reuse the application's single traced client.
  client?: AgentChatClient;
}

export function createLocalRuntime(options: LocalRuntimeOptions): AgentRuntime {
  // Annotated rather than inferred, so a plain OpenAI client and the
  // application's traced wrapper are the same type here.
  const client: AgentChatClient = options.client ?? new OpenAI({ apiKey: options.apiKey });

  return {
    name: "local-openai-tool-loop",

    async stream(input, emit) {
      const tools: ChatCompletionTool[] = AGENT_TOOL_DEFINITIONS.map((definition) => ({
        type: "function",
        function: {
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters as unknown as Record<string, unknown>,
        },
      }));

      // The selected file is context about what the reader is looking at, never
      // a scope and never an instruction. It is phrased as an observation so a
      // selection cannot be read as a command.
      const selectionLine = input.selectedPath
        ? `The reader currently has this file selected on the map: \`${input.selectedPath}\`. Treat it as context if the question is about that file; ignore it if the question is about the repository.`
        : "";

      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: AGENT_INSTRUCTIONS },
        ...input.history.map(
          (message): ChatCompletionMessageParam => ({
            role: message.role,
            content: message.content,
          }),
        ),
        {
          role: "user",
          content: [selectionLine, input.userMessage].filter(Boolean).join("\n\n"),
        },
      ];

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // `stream()` returns an async-iterable stream directly on this SDK
        // version, so there is nothing to await before iterating it.
        const stream = client.chat.completions.stream({
          model: options.model,
          messages,
          tools,
          stream: true,
        });

        const toolCalls: { id: string; name: string; arguments: string }[] = [];
        let finishReason = "stop";

        for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
          const choice = chunk.choices[0];
          if (!choice) continue;
          const delta = choice.delta;
          if (delta?.content) await emit({ type: "token", text: delta.content });
          for (const toolCall of delta?.tool_calls ?? []) {
            const index = toolCall.index ?? 0;
            const existing = toolCalls[index];
            if (!existing) {
              toolCalls[index] = {
                id: toolCall.id ?? "",
                name: toolCall.function?.name ?? "",
                arguments: toolCall.function?.arguments ?? "",
              };
              continue;
            }
            if (toolCall.id) existing.id = toolCall.id;
            if (toolCall.function?.name) existing.name += toolCall.function.name;
            if (toolCall.function?.arguments) existing.arguments += toolCall.function.arguments;
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        const pending = toolCalls.filter((call) => call.name);
        if (pending.length === 0) {
          await emit({ type: "done", finishReason });
          return;
        }

        // The assistant's own tool calls go back into the conversation, so the
        // model sees what it asked for before the results arrive.
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: pending.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        });

        for (const call of pending) {
          const name = call.name as AgentToolName;
          const isKnown = (AGENT_TOOL_NAMES as readonly string[]).includes(call.name);
          await emit({
            type: "tool_call",
            name: call.name,
            label: TOOL_PROGRESS_LABEL[call.name] ?? `Calling ${call.name}`,
          });

          let payload: string;
          if (!isKnown) {
            payload = JSON.stringify({
              error: `Unknown tool \`${call.name}\`. The available tools are: ${AGENT_TOOL_NAMES.join(", ")}.`,
            });
            await emit({
              type: "tool_result",
              name: call.name,
              ok: false,
              summary: "Unknown tool",
            });
          } else {
            let parsedArguments: unknown;
            try {
              parsedArguments = call.arguments.trim() ? JSON.parse(call.arguments) : {};
            } catch {
              parsedArguments = null;
            }

            if (parsedArguments === null) {
              payload = JSON.stringify({
                error: "The tool arguments were not valid JSON. Send a JSON object matching the tool's documented fields.",
              });
              await emit({
                type: "tool_result",
                name: call.name,
                ok: false,
                summary: "Invalid arguments",
              });
            } else {
              const outcome = runTool(input.analysis, name, parsedArguments);
              payload = JSON.stringify(outcome.data);
              await emit({
                type: "tool_result",
                name: call.name,
                ok: outcome.ok,
                summary: outcome.ok
                  ? summariseToolResult(call.name, outcome.data)
                  : outcome.data.error,
              });
            }
          }

          messages.push({ role: "tool", tool_call_id: call.id, content: payload });
        }
      }

      // Out of rounds. The message is honest rather than a truncated answer.
      await emit({
        type: "error",
        message: "I reached the limit of lookups before finishing that. Ask it in a shorter form and I will try again.",
      });
    },
  };
}

type ToolCallOutcome = { ok: true; data: unknown } | { ok: false; data: { error: string } };

// Turns a thrown contract error into an error the model can read and correct,
// rather than a failure of the turn. A path that is not in the analysis is an
// answer about the repository, not a server fault.
function runTool(analysis: ParseResult, name: AgentToolName, input: unknown): ToolCallOutcome {
  try {
    const outcome = runAgentTool(analysis, name, input);
    if (outcome.ok) return { ok: true, data: outcome.data };
    return { ok: false, data: { error: outcome.error } };
  } catch (error) {
    if (error instanceof UnknownPathError || error instanceof UnsupportedRoleError) {
      return { ok: false, data: { error: error.message } };
    }
    throw error;
  }
}
