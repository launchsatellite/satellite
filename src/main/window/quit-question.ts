import type { MessageBoxOptions } from "electron";

export const quitButton = 0;

export function quitQuestion(sessions: number): MessageBoxOptions {
  return {
    type: "warning",
    message:
      sessions === 1
        ? "1 Claude Code session is running"
        : `${String(sessions)} Claude Code sessions are running`,
    detail:
      "Quitting Satellite ends them and anything they started. Each workspace offers to resume its conversation next time.",
    buttons: ["Quit Satellite", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}
