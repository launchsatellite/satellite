import { z } from "zod";
import { firstMessage as firstMessageSchema } from "../../shared/bridge-contract.ts";
import { isFullyQualified } from "../platform/paths.ts";

export type HookEventName = (typeof hookEvents)[number];
export type ClaudeStart =
  { kind: "new"; sessionId: string; firstMessage?: string } | { kind: "resume"; sessionId: string };
interface HttpHook {
  type: "http";
  url: string;
  headers: { Authorization: string };
  timeout: 5;
}

export const hookEvents = [
  "UserPromptSubmit",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "StopFailure",
] as const;

const sessionIdSchema = z.uuid();
const startFlags = { new: "--session-id", resume: "--resume" } as const;

export function claudeArgs(start: ClaudeStart, settingsFile: string | undefined): string[] {
  if (!sessionIdSchema.safeParse(start.sessionId).success) {
    throw new Error("Claude Code's session id must be a UUID");
  }
  const message = start.kind === "new" ? start.firstMessage : undefined;
  if (message !== undefined && !firstMessageSchema.safeParse(message).success) {
    throw new Error("Claude Code's first message must hold two words and no NUL");
  }
  const args = [startFlags[start.kind], start.sessionId];
  if (settingsFile !== undefined && !isFullyQualified(settingsFile)) {
    throw new Error("Claude Code's settings file must be a fully qualified path");
  }
  return [
    ...args,
    ...(settingsFile === undefined ? [] : ["--settings", settingsFile]),
    ...(message === undefined ? [] : ["--", message]),
  ];
}

export function hookSettings(
  baseUrl: string,
  secret: string,
): { hooks: Record<HookEventName, [{ hooks: [HttpHook] }]> } {
  const entry = (event: HookEventName): [{ hooks: [HttpHook] }] => [
    {
      hooks: [
        {
          type: "http",
          url: `${baseUrl}/${event}`,
          headers: { Authorization: `Bearer ${secret}` },
          timeout: 5,
        },
      ],
    },
  ];
  return {
    hooks: {
      UserPromptSubmit: entry("UserPromptSubmit"),
      PermissionRequest: entry("PermissionRequest"),
      PostToolUse: entry("PostToolUse"),
      PostToolUseFailure: entry("PostToolUseFailure"),
      Notification: entry("Notification"),
      Stop: entry("Stop"),
      StopFailure: entry("StopFailure"),
    },
  };
}
