import type { ITheme } from "@xterm/xterm";
import { thumbColours } from "../ui/scrollbar-look.ts";
import { shownLook } from "../ui/shown-theme.ts";

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
    overviewRulerBorder: "#00000000",
  };
}

export function terminalTheme(): ITheme {
  const look = shownLook();
  if (look !== undefined) return withScrollbar({ ...look.terminal }, look.tokens.fg);
  const styles = getComputedStyle(document.documentElement);
  const fg = token(styles, "fg");
  return withScrollbar(
    {
      background: token(styles, "bg"),
      foreground: fg,
      cursor: fg,
      cursorAccent: token(styles, "bg"),
      selectionBackground: token(styles, "ctl"),
    },
    fg,
  );
}
