import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Button, type ButtonProps } from "../ui/button.tsx";
import type { IconName } from "../ui/icon.tsx";
import type { Command, CommandId, CommandRegistry } from "./command-registry.ts";
import { keyboardPlatform, shortcutLabel } from "./shortcuts.ts";

interface CommandButtonProps {
  command: CommandId;
  children?: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: IconName;
  testId?: string;
}

const platform = keyboardPlatform();
const CommandsContext = createContext<CommandRegistry | null>(null);

function insideTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".xterm") !== null;
}

export function commandShortcut(command: Command): string | undefined {
  return command.shortcut === undefined ? undefined : shortcutLabel(command.shortcut, platform);
}

export function CommandsProvider({
  registry,
  children,
}: {
  registry: CommandRegistry;
  children: ReactNode;
}) {
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (platform === "other" && insideTerminal(event.target)) return;
      const command = registry.forKey(event, platform);
      if (!command?.available) return;
      event.preventDefault();
      event.stopPropagation();
      command.run();
    };
    window.addEventListener("keydown", press, { capture: true });
    return () => {
      window.removeEventListener("keydown", press, { capture: true });
    };
  }, [registry]);
  return <CommandsContext value={registry}>{children}</CommandsContext>;
}

export function useCommands(): CommandRegistry {
  const registry = useContext(CommandsContext);
  if (registry === null) throw new Error("useCommands needs a CommandsProvider above it.");
  return registry;
}

export function CommandButton({
  command,
  children,
  variant,
  size,
  icon,
  testId,
}: CommandButtonProps) {
  const found = useCommands().get(command);
  if (found === undefined) throw new Error(`The command ${command} is not registered.`);
  return (
    <Button
      onClick={found.run}
      testId={testId}
      variant={variant}
      size={size}
      icon={icon}
      shortcut={commandShortcut(found)}
      disabled={!found.available}
    >
      {children ?? found.title}
    </Button>
  );
}
