import type { SessionStatus } from "../../shared/bridge-contract.ts";
import type { HookEventName } from "./claude-launch.ts";

export type Agent = string | null;
export interface SessionState {
  readonly status: SessionStatus;
  readonly asker: Agent;
}
export type SessionEvent =
  | { name: "SessionStart"; source: string | null; sessionId: string | null }
  | { name: "Notification"; type: string | null; agent: Agent }
  | { name: AgentEventName; agent: Agent }
  | { name: Exclude<HookEventName, "SessionStart" | "Notification" | AgentEventName> }
  | { name: "Exit" };
type AgentEventName = "PermissionRequest" | "PostToolUse" | "PostToolUseFailure";

export const mainThread = "";

const asks = new Set([
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);
const answers = new Set(["elicitation_complete", "elicitation_response"]);

function afterNotification(current: SessionState, type: string | null, agent: Agent): SessionState {
  const { status } = current;
  if (type !== null && asks.has(type)) {
    return status === "needs-you" ? current : { status: "needs-you", asker: agent };
  }
  if (type !== null && answers.has(type)) {
    return status === "needs-you" ? { ...current, status: "working" } : current;
  }
  if (type === "idle_prompt" && (status === "working" || status === "needs-you")) {
    return { ...current, status: "done" };
  }
  return current;
}

function afterTool(current: SessionState, agent: Agent): SessionState {
  const { status, asker } = current;
  if (status !== "needs-you" || asker === null || (agent !== null && agent === asker)) {
    return { ...current, status: "working" };
  }
  return current;
}

export function nextState(current: SessionState, event: SessionEvent): SessionState {
  if (current.status === "stopped") return current;
  switch (event.name) {
    case "Exit":
      return { ...current, status: "stopped" };
    case "SessionStart":
      return event.source === "compact" ? current : { ...current, status: "idle" };
    case "Notification":
      return afterNotification(current, event.type, event.agent);
    case "PostToolUse":
    case "PostToolUseFailure":
      return afterTool(current, event.agent);
    case "PermissionRequest":
      return { status: "needs-you", asker: event.agent };
    case "UserPromptSubmit":
      return { ...current, status: "working" };
    case "Stop":
    case "StopFailure":
      return { ...current, status: "done" };
  }
}
