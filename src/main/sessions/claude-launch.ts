import { z } from "zod";
import { isFullyQualified } from "../platform/paths.ts";

export type HookEventName = (typeof hookEvents)[number];
export type ClaudeStart =
  { kind: "new"; sessionId: string } | { kind: "resume"; sessionId: string };
interface HttpHook {
  type: "http";
  url: string;
  headers: { Authorization: string };
  timeout: 5;
}

export const hookEvents = [
  "SessionStart",
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
  const args = [startFlags[start.kind], start.sessionId];
  if (settingsFile === undefined) return args;
  if (!isFullyQualified(settingsFile)) {
    throw new Error("Claude Code's settings file must be a fully qualified path");
  }
  return [...args, "--settings", settingsFile];
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
      SessionStart: entry("SessionStart"),
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
