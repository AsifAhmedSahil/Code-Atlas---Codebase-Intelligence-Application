// The shapes the application and the agent service exchange. Deliberately free
// of any model or database import, so the browser-facing side of the protocol
// never pulls a runtime into the web application's bundle.

// A turn of conversation. Only user and assistant text crosses this boundary;
// tool calls are events on the stream, not messages, so a client cannot inject
// a tool result by forging history.
export interface AgentChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentTurnRequest {
  messages: AgentChatMessage[];
  // Present only when a file is selected in the map. It is a hint about what
  // the reader is looking at, never a scope: it cannot widen what the
  // credential allows.
  selectedPath?: string;
}

// The events the agent service emits while it works, and the application
// relays. Everything is JSON-serialisable and small; tool results are reported
// as a one-line summary, never the full payload, so a large walk cannot flood
// the stream.
export type AgentStreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; label: string }
  | { type: "tool_result"; name: string; ok: boolean; summary: string }
  | { type: "done"; finishReason: string }
  | { type: "error"; message: string };

// A one-line human-readable summary of a tool result, for the progress
// indicator. Deliberately counts, not content: the full payload stays in the
// tool result handed back to the model.
export function summariseToolResult(name: string, data: unknown): string {
  if (typeof data !== "object" || data === null) return "Done";
  const value = data as Record<string, unknown>;
  switch (name) {
    case "analysis_summary":
      return typeof value.counts === "object" && value.counts !== null
        ? `${(value.counts as { parsed?: number }).parsed ?? 0} files read`
        : "Summary read";
    case "search_files":
      return `${typeof value.matched === "number" ? value.matched : 0} files matched`;
    case "list_files_by_role":
      return `${typeof value.matched === "number" ? value.matched : 0} files with that role`;
    case "direct_neighbours":
      return `${Array.isArray(value.dependencies) ? value.dependencies.length : 0} dependencies, ${
        Array.isArray(value.dependents) ? value.dependents.length : 0
      } dependents`;
    case "transitive_walk":
      return `${typeof value.reachableTotal === "number" ? value.reachableTotal : 0} files reachable`;
    case "route_table":
      return `${typeof value.total === "number" ? value.total : 0} routes`;
    default:
      return "Done";
  }
}
