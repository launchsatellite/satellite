import type { CuratedThemeId } from "../../shared/themes/curated-themes.ts";
import {
  matchesShortcut,
  type KeyPress,
  type KeyboardPlatform,
  type Shortcut,
} from "./shortcuts.ts";

export type CommandId =
  | "palette.commands"
  | "palette.agents"
  | "palette.switcher"
  | "focus.sidebar"
  | "sidebar.toggle"
  | "focus.repository"
  | "focus.terminal"
  | "project.add"
  | "project.remove"
  | "project.up"
  | "project.down"
  | "workspace.new"
  | "workspace.archive"
  | "session.new"
  | "session.close"
  | "session.next"
  | "session.previous"
  | "settings.show"
  | "tools.check"
  | "guide.show"
  | "theme.system"
  | "theme.light"
  | "theme.dark"
  | `theme.${CuratedThemeId}`
  | "notifications.off"
  | "notifications.on"
  | "inbox.newest"
  | "files.show"
  | "files.open"
  | "changes.show"
  | "changes.branch"
  | "changes.uncommitted"
  | "changes.inline"
  | "changes.side-by-side"
  | "changes.update-from-base"
  | "changes.send-lines"
  | "pull-request.show"
  | "pull-request.open"
  | "pull-request.next-thread"
  | "processes.show";

export interface Command {
  id: CommandId;
  title: string;
  shortcut?: Shortcut;
  whenFocusIn?: string;
  available: boolean;
  run: () => void;
}

export interface CommandRegistry {
  readonly commands: readonly Command[];
  get: (id: CommandId) => Command | undefined;
  forKey: (press: KeyPress, platform: KeyboardPlatform) => Command | undefined;
}

export function createCommandRegistry(commands: readonly Command[]): CommandRegistry {
  const byId = new Map<CommandId, Command>();
  const shortcuts = new Set<string>();
  for (const command of commands) {
    if (byId.has(command.id)) throw new Error(`Two commands share the id ${command.id}.`);
    byId.set(command.id, command);
    if (command.shortcut === undefined) continue;
    const key = command.shortcut.key.toLowerCase();
    if (shortcuts.has(key)) throw new Error(`Two commands share the shortcut ${key}.`);
    shortcuts.add(key);
  }
  return {
    commands,
    get: (id) => byId.get(id),
    forKey: (press, platform) =>
      commands.find(
        (command) =>
          command.shortcut !== undefined && matchesShortcut(press, command.shortcut, platform),
      ),
  };
}
