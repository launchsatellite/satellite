import {
  matchesShortcut,
  type KeyPress,
  type KeyboardPlatform,
  type Shortcut,
} from "./shortcuts.ts";

export type CommandId =
  | "palette.commands"
  | "palette.switcher"
  | "project.add"
  | "project.remove"
  | "tools.check"
  | "theme.system"
  | "theme.light"
  | "theme.dark";

export interface Command {
  id: CommandId;
  title: string;
  shortcut?: Shortcut;
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
    const key = `${command.shortcut.shift === true ? "shift+" : ""}${command.shortcut.key.toLowerCase()}`;
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
