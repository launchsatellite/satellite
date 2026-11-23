import type { MessageBoxOptions } from "electron";

export const quitButton = 0;

export function quitQuestion(sessions: number): MessageBoxOptions {
  const one = sessions === 1;
  return {
    type: "warning",
    message: one
      ? "1 Claude Code session is mid-task"
      : `${String(sessions)} Claude Code sessions are mid-task`,
    detail: one
      ? "Quitting Satellite stops it and anything it started. Its workspace resumes the conversation when you next open it."
      : "Quitting Satellite stops them and anything they started. Each workspace resumes its conversation when you next open it.",
    buttons: ["Quit Satellite", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}
