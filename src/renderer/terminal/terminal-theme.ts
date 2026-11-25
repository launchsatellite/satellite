import type { ITheme } from "@xterm/xterm";
import { thumbColours } from "../ui/scrollbar-look.ts";
import { shownLook } from "../ui/shown-theme.ts";
import { tokenHexReader } from "../ui/token-hex.ts";

function token(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(`--${name}`).trim();
}

function withScrollbar(theme: ITheme, fg: string): ITheme {
  const { rest, hover, drag } = thumbColours(fg);
  return {
    ...theme,
    scrollbarSliderBackground: rest,
    scrollbarSliderHoverBackground: hover,
    scrollbarSliderActiveBackground: drag,
  };
}

export function terminalTheme(): ITheme {
  const look = shownLook();
  if (look !== undefined) return withScrollbar({ ...look.terminal }, look.tokens.fg);
  const styles = getComputedStyle(document.documentElement);
  return withScrollbar(
    {
      background: token(styles, "bg"),
      foreground: token(styles, "fg"),
      cursor: token(styles, "fg"),
      cursorAccent: token(styles, "bg"),
      selectionBackground: token(styles, "ctl"),
    },
    tokenHexReader()("fg"),
  );
}
