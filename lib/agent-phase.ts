export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string; progress?: string }[] }
  | null;

export interface ActiveToolSnapshot {
  id: string;
  name: string;
  progress?: string;
}

/** Subset of the server agent state that decides which activity label to show. */
export interface AgentStateSnapshot {
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  activeTools?: ActiveToolSnapshot[];
}

/**
 * Pi keeps `isStreaming` true for the whole turn, including while tools run, so
 * it cannot tell "the model is generating" apart from "a command is running".
 * Prefer the server's active tool list, and only trust it while the turn is
 * actually busy so a stale entry cannot pin the label after the agent stops.
 */
export function deriveAgentPhase(state?: AgentStateSnapshot): AgentPhase {
  if (!state) return null;
  if (!state.isStreaming && !state.isPromptRunning) return null;
  const tools = state.activeTools ?? [];
  if (tools.length > 0) return { kind: "running_tools", tools };
  return state.isStreaming ? { kind: "waiting_model" } : { kind: "running_command" };
}
