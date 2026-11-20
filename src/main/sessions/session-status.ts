import type { SessionStatus } from "../../shared/bridge-contract.ts";
import type { HookEventName } from "./claude-launch.ts";

export type Agent = string | null;
export interface SessionState {
  readonly status: SessionStatus;
  readonly askers: readonly Agent[];
}
export type SessionEvent =
  | { name: "Notification"; type: string | null; agent: Agent }
  | { name: AgentEventName; agent: Agent }
  | { name: Exclude<HookEventName, "Notification" | AgentEventName> }
  | { name: "Exit" };
type AgentEventName = "PermissionRequest" | "PostToolUse" | "PostToolUseFailure";

export const mainThread = "";

const askerLimit = 16;
const asks = new Set([
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);
const answers = new Set(["elicitation_complete", "elicitation_response"]);

function asking(current: SessionState, agent: Agent): SessionState {
  const askers = current.status === "needs-you" ? current.askers : [];
  return { status: "needs-you", askers: [...askers, agent].slice(-askerLimit) };
}

function afterNotification(current: SessionState, type: string | null, agent: Agent): SessionState {
  const { status } = current;
  if (type !== null && asks.has(type)) {
    return status === "needs-you" ? current : asking(current, agent);
  }
  if (type !== null && answers.has(type)) {
    return status === "needs-you" ? { status: "working", askers: [] } : current;
  }
  if (type === "idle_prompt" && (status === "working" || status === "needs-you")) {
    return { status: "done", askers: [] };
  }
  return current;
}

function afterTool(current: SessionState, agent: Agent): SessionState {
  if (current.status !== "needs-you") return { status: "working", askers: [] };
  const known = agent === null ? -1 : current.askers.indexOf(agent);
  const answered = known === -1 ? current.askers.indexOf(null) : known;
  const askers = current.askers.filter((_, index) => index !== answered);
  return askers.length === 0 ? { status: "working", askers } : { ...current, askers };
}

export function nextState(current: SessionState, event: SessionEvent): SessionState {
  if (current.status === "stopped") return current;
  switch (event.name) {
    case "Exit":
      return { status: "stopped", askers: [] };
    case "Notification":
      return afterNotification(current, event.type, event.agent);
    case "PostToolUse":
    case "PostToolUseFailure":
      return afterTool(current, event.agent);
    case "PermissionRequest":
      return asking(current, event.agent);
    case "UserPromptSubmit":
      return { status: "working", askers: [] };
    case "Stop":
    case "StopFailure":
      return { status: "done", askers: [] };
  }
}
