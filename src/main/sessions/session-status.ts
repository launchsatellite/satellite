import type { SessionStatus } from "../../shared/bridge-contract.ts";
import type { HookEventName } from "./claude-launch.ts";

export type SessionEvent =
  | { name: "SessionStart"; source: string | null; sessionId: string | null }
  | { name: "Notification"; type: string | null }
  | { name: Exclude<HookEventName, "SessionStart" | "Notification"> }
  | { name: "Exit" };

const asks = new Set([
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);
const answers = new Set(["elicitation_complete", "elicitation_response"]);

function afterNotification(current: SessionStatus, type: string | null): SessionStatus {
  if (type !== null && asks.has(type)) return "needs-you";
  if (type !== null && answers.has(type)) return current === "needs-you" ? "working" : current;
  if (type === "idle_prompt")
    return current === "working" || current === "needs-you" ? "done" : current;
  return current;
}

export function nextStatus(current: SessionStatus, event: SessionEvent): SessionStatus {
  if (current === "stopped") return current;
  switch (event.name) {
    case "Exit":
      return "stopped";
    case "SessionStart":
      return event.source === "compact" ? current : "idle";
    case "Notification":
      return afterNotification(current, event.type);
    case "UserPromptSubmit":
    case "PostToolUse":
    case "PostToolUseFailure":
      return "working";
    case "PermissionRequest":
      return "needs-you";
    case "Stop":
    case "StopFailure":
      return "done";
  }
}
