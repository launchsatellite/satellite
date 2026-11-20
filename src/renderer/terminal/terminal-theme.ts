import type { ITheme } from "@xterm/xterm";

function token(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(`--${name}`).trim();
}

export function terminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: token(styles, "bg"),
    foreground: token(styles, "fg"),
    cursor: token(styles, "fg"),
    cursorAccent: token(styles, "bg"),
    selectionBackground: token(styles, "ctl"),
  };
}
