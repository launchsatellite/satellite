import type { ITheme } from "@xterm/xterm";
import { shownLook } from "../ui/shown-theme.ts";

function token(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(`--${name}`).trim();
}

export function terminalTheme(): ITheme {
  const look = shownLook();
  if (look !== undefined) return { ...look.terminal };
  const styles = getComputedStyle(document.documentElement);
  return {
    background: token(styles, "bg"),
    foreground: token(styles, "fg"),
    cursor: token(styles, "fg"),
    cursorAccent: token(styles, "bg"),
    selectionBackground: token(styles, "ctl"),
  };
}
