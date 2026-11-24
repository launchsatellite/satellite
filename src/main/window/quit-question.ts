import type { MessageBoxOptions } from "electron";

export interface QuitFacts {
  sessions: number;
  midTask: number;
  unseen: number;
  processes: number | null;
}

export const quitButton = 0;

function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function listed(parts: readonly string[]): string {
  return parts.length < 2
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

export function asksToQuit({ sessions, midTask, unseen, processes }: QuitFacts): boolean {
  if (sessions === 0) return false;
  return midTask > 0 || unseen > 0 || processes !== 0;
}

export function quitQuestion({ midTask, unseen, processes }: QuitFacts): MessageBoxOptions {
  const parts = [
    ...(midTask > 0
      ? [counted(midTask, "Claude Code session mid-task", "Claude Code sessions mid-task")]
      : []),
    ...(unseen > 0
      ? [
          counted(
            unseen,
            "session whose status Satellite can't see",
            "sessions whose status Satellite can't see",
          ),
        ]
      : []),
    ...(processes === null
      ? ["anything Claude Code started, which Satellite couldn't check in time"]
      : processes > 0
        ? [counted(processes, "process Claude Code started", "processes Claude Code started")]
        : []),
  ];
  return {
    type: "warning",
    message: `Quitting stops ${listed(parts)}.`,
    detail: "Each workspace picks up the conversation last prompted there when you next open it.",
    buttons: ["Quit Satellite", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}
