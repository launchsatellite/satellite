import { z } from "zod";

export const appTokens = [
  "bg",
  "win",
  "side",
  "raised",
  "sel",
  "hover",
  "line",
  "ctl",
  "fg",
  "fg2",
  "dim",
  "sigfg",
  "add",
  "addfg",
  "del",
  "delfg",
  "accent",
  "signal",
  "pri-bg",
  "pri-fg",
  "volt",
  "volt-edge",
  "lilac",
  "lilac-edge",
  "working",
  "idle",
  "danger",
] as const;
export const terminalColourNames = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

export const pairedGrounds = ["raised", "sel", "hover"] as const;
export const textTokens = ["fg", "fg2", "dim", "sigfg", "addfg", "delfg", "danger"] as const;
export const pixelTokens = ["working", "idle", "signal", "volt", "lilac"] as const;
export const contrastFloors = { text: 4.5, edge: 3, control: 1.3 };

export type AppToken = (typeof appTokens)[number];
export type PairedGround = (typeof pairedGrounds)[number];
export type PairedToken = (typeof textTokens)[number] | (typeof pixelTokens)[number];
export type ThemeType = "light" | "dark";
export interface StateKeys {
  working: string;
  needsYou: string;
  ready: string;
  done: string;
  idle: string;
  danger: string;
}
export interface TokenColour {
  scope: string[];
  settings: { foreground?: string; fontStyle?: string };
}
export interface EditorTheme {
  name: string;
  type: ThemeType;
  colors: Record<string, string>;
  tokenColors: TokenColour[];
}
export type TerminalColours = Record<
  "background" | "foreground" | "cursor" | "cursorAccent" | "selectionBackground",
  string
> &
  Partial<Record<(typeof terminalColourNames)[number], string>>;
export interface ThemeLook {
  type: ThemeType;
  tokens: Record<AppToken, string>;
  shadow: string;
  selection: string;
  terminal: TerminalColours;
  editor: EditorTheme;
  overlay: { color: string; symbolColor: string };
  paired: Record<PairedGround, Record<PairedToken, string>>;
}
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const strictHex = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const themeName = /^[a-z0-9][a-z0-9-]{0,63}$/;
const fontStyles = /^(?:[a-z]{1,20}(?: [a-z]{1,20}){0,3})?$/;
const scopeText = /^[\w.\-+#:()*>^$!&|, ]{1,300}$/u;
const colourKey = /^[A-Za-z][\w.-]{0,99}$/;
const shadows: Record<ThemeType, string> = {
  dark: "0 16px 40px rgb(0 0 0 / 0.55)",
  light: "0 16px 40px rgb(10 10 11 / 0.12)",
};
const publishedTheme = z.object({
  name: z.string().regex(themeName),
  type: z.enum(["light", "dark"]),
  colors: z.record(z.string().max(100), z.unknown()),
  tokenColors: z.array(z.unknown()).max(4000),
});
const tokenColourEntry = z.object({
  scope: z.union([z.string().max(20_000), z.array(z.string().max(300)).max(500)]).optional(),
  settings: z.object({ foreground: z.unknown(), fontStyle: z.unknown() }).partial(),
});
const groundForeground: Record<PairedGround, string[]> = {
  raised: ["quickInput.foreground", "editorWidget.foreground"],
  sel: ["list.activeSelectionForeground"],
  hover: ["list.hoverForeground"],
};
const neutralText = new Set<string>(["fg", "fg2", "dim"]);
const black: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const white: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const formatDefaults = {
  insertedLine: { r: 155, g: 185, b: 85, a: 0.2 },
  removedLine: { r: 255, g: 0, b: 0, a: 0.2 },
};
const ansiKeys: Record<(typeof terminalColourNames)[number], string> = {
  black: "terminal.ansiBlack",
  red: "terminal.ansiRed",
  green: "terminal.ansiGreen",
  yellow: "terminal.ansiYellow",
  blue: "terminal.ansiBlue",
  magenta: "terminal.ansiMagenta",
  cyan: "terminal.ansiCyan",
  white: "terminal.ansiWhite",
  brightBlack: "terminal.ansiBrightBlack",
  brightRed: "terminal.ansiBrightRed",
  brightGreen: "terminal.ansiBrightGreen",
  brightYellow: "terminal.ansiBrightYellow",
  brightBlue: "terminal.ansiBrightBlue",
  brightMagenta: "terminal.ansiBrightMagenta",
  brightCyan: "terminal.ansiBrightCyan",
  brightWhite: "terminal.ansiBrightWhite",
};

export function parseColour(value: unknown): Rgba | undefined {
  if (typeof value !== "string" || !strictHex.test(value)) return undefined;
  const digits = value.slice(1);
  const full = digits.length <= 4 ? digits.replace(/./g, "$&$&") : digits;
  const channel = (at: number) => Number.parseInt(full.slice(at, at + 2), 16);
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: full.length === 8 ? channel(6) / 255 : 1,
  };
}

function hexOf({ r, g, b, a }: Rgba): string {
  const pair = (channel: number) => Math.round(channel).toString(16).padStart(2, "0");
  return `#${pair(r)}${pair(g)}${pair(b)}${a < 1 ? pair(a * 255) : ""}`;
}

function over(top: Rgba, ground: Rgba): Rgba {
  const mix = (front: number, back: number) => front * top.a + back * (1 - top.a);
  return { r: mix(top.r, ground.r), g: mix(top.g, ground.g), b: mix(top.b, ground.b), a: 1 };
}

function luminance(colour: Rgba): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
}

function ratioOf(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

function mixed(from: Rgba, to: Rgba, amount: number): Rgba {
  return over({ ...to, a: amount }, from);
}

function reach(start: Rgba, toward: Rgba, grounds: Rgba[], ratio: number): Rgba {
  const least = (colour: Rgba) => Math.min(...grounds.map((ground) => ratioOf(colour, ground)));
  const extreme = least(black) >= least(white) ? black : white;
  for (const target of [toward, extreme, extreme === black ? white : black]) {
    for (let step = 0; step <= 40; step++) {
      const { r, g, b } = mixed(start, target, step / 40);
      const tone = { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: 1 };
      if (least(tone) >= ratio) return tone;
    }
  }
  return extreme;
}

function cleanColours(colors: Record<string, unknown>): Map<string, Rgba> {
  const clean = new Map<string, Rgba>();
  for (const [key, value] of Object.entries(colors)) {
    const colour = parseColour(value);
    if (colour !== undefined && colourKey.test(key)) clean.set(key, colour);
  }
  return clean;
}

function cleanTokenColours(entries: unknown[]): TokenColour[] {
  return entries.flatMap((entry) => {
    const parsed = tokenColourEntry.safeParse(entry);
    if (!parsed.success) return [];
    const { scope, settings } = parsed.data;
    const scopes = (typeof scope === "string" ? scope.split(",") : (scope ?? []))
      .map((part) => part.trim())
      .filter((part) => scopeText.test(part));
    const foreground = parseColour(settings.foreground);
    const fontStyle =
      typeof settings.fontStyle === "string" && fontStyles.test(settings.fontStyle)
        ? settings.fontStyle
        : undefined;
    if (scopes.length === 0 || (foreground === undefined && fontStyle === undefined)) return [];
    return [
      {
        scope: scopes,
        settings: {
          ...(foreground === undefined ? {} : { foreground: hexOf(foreground) }),
          ...(fontStyle === undefined ? {} : { fontStyle }),
        },
      },
    ];
  });
}

export function themeLook(published: unknown, states: StateKeys): ThemeLook | undefined {
  const parsed = publishedTheme.safeParse(published);
  if (!parsed.success) return undefined;
  const { name, type } = parsed.data;
  const colours = cleanColours(parsed.data.colors);
  const pick = (...keys: string[]) =>
    keys.map((key) => colours.get(key)).find((colour) => colour !== undefined);
  const editorBackground = pick("editor.background");
  const editorForeground = pick("foreground", "editor.foreground");
  const working = pick(states.working);
  const needsYou = pick(states.needsYou);
  const ready = pick(states.ready);
  const done = pick(states.done);
  const idle = pick(states.idle);
  const danger = pick(states.danger);
  if (
    editorBackground === undefined ||
    editorForeground === undefined ||
    working === undefined ||
    needsYou === undefined ||
    ready === undefined ||
    done === undefined ||
    idle === undefined ||
    danger === undefined
  ) {
    return undefined;
  }
  const bg = over(editorBackground, type === "dark" ? black : white);
  const side = over(pick("sideBar.background") ?? bg, bg);
  const flat = (colour: Rgba | undefined, ground: Rgba, fallback: Rgba) =>
    hexOf(over(colour ?? fallback, ground));
  const fg = over(editorForeground, bg);
  const faded = (alpha: number) => ({ ...editorForeground, a: editorForeground.a * alpha });
  const line = flat(pick("sideBar.border", "tab.border", "editorGroup.border"), side, faded(0.12));
  const raisedFill =
    ["quickInput.background", "editorWidget.background", "dropdown.background", "editor.background"]
      .map((key) => colours.get(key))
      .filter((colour) => colour !== undefined)
      .map((colour) => over(colour, side))
      .find((colour) => hexOf(colour) !== hexOf(side)) ?? side;
  const edgeKeys = ["input.border", "dropdown.border", "settings.textInputBorder"];
  const edgeGrounds = [side, raisedFill, bg];
  const ctl =
    edgeKeys
      .map((key) => colours.get(key))
      .filter((colour) => colour !== undefined)
      .map((colour) => over(colour, side))
      .find((colour) =>
        edgeGrounds.every((ground) => ratioOf(colour, ground) >= contrastFloors.control),
      ) ?? reach(side, fg, edgeGrounds, contrastFloors.control);
  const shownEdge = (fill: Rgba) =>
    type === "dark" ? hexOf(fill) : hexOf(reach(fill, fg, [bg, side], contrastFloors.edge));
  const tokens: Record<AppToken, string> = {
    bg: hexOf(bg),
    win: hexOf(side),
    side: hexOf(side),
    raised: hexOf(raisedFill),
    sel: flat(pick("list.activeSelectionBackground"), side, faded(0.16)),
    hover: flat(pick("list.hoverBackground"), side, faded(0.08)),
    line,
    ctl: hexOf(ctl),
    fg: hexOf(fg),
    fg2: flat(pick("descriptionForeground"), bg, faded(0.7)),
    dim: flat(pick("tab.inactiveForeground", "editorLineNumber.foreground"), bg, faded(0.5)),
    sigfg: flat(needsYou, bg, needsYou),
    add: flat(pick("diffEditor.insertedLineBackground"), bg, formatDefaults.insertedLine),
    addfg: flat(
      pick("gitDecoration.addedResourceForeground", "gitDecoration.untrackedResourceForeground"),
      bg,
      ready,
    ),
    del: flat(pick("diffEditor.removedLineBackground"), bg, formatDefaults.removedLine),
    delfg: flat(pick("gitDecoration.deletedResourceForeground"), bg, danger),
    accent: hexOf(
      reach(over(pick("focusBorder") ?? working, bg), fg, edgeGrounds, contrastFloors.edge),
    ),
    signal: flat(needsYou, bg, needsYou),
    "pri-bg": flat(pick("button.background"), bg, working),
    "pri-fg": flat(pick("button.foreground"), bg, fg),
    volt: flat(ready, bg, ready),
    "volt-edge": shownEdge(over(ready, bg)),
    lilac: flat(done, bg, done),
    "lilac-edge": shownEdge(over(done, bg)),
    working: flat(working, bg, working),
    idle: flat(idle, bg, idle),
    danger: flat(danger, bg, danger),
  };
  const pairedOn = (groundName: PairedGround): Record<PairedToken, string> => {
    const ground = parseColour(tokens[groundName]) ?? bg;
    const ownText = groundForeground[groundName]
      .map((key) => colours.get(key))
      .find((colour) => colour !== undefined);
    const floored = (token: PairedToken, ratio: number, above?: string): string => {
      const colour = parseColour(tokens[token]) ?? fg;
      const ceiling = parseColour(above ?? "");
      if (ratioOf(colour, ground) >= ratio) {
        return ceiling !== undefined && ratioOf(colour, ground) > ratioOf(ceiling, ground)
          ? hexOf(ceiling)
          : tokens[token];
      }
      const own = ownText === undefined ? undefined : over(ownText, ground);
      const ownFits =
        own !== undefined &&
        ratioOf(own, ground) >= ratio &&
        (ceiling === undefined || ratioOf(own, ground) <= ratioOf(ceiling, ground));
      if (neutralText.has(token) && ownFits) return hexOf(own);
      const mixed = reach(colour, fg, [ground], ratio);
      return ceiling !== undefined && ratioOf(mixed, ground) > ratioOf(ceiling, ground)
        ? hexOf(ceiling)
        : hexOf(mixed);
    };
    const text = (token: PairedToken, above?: string) => floored(token, contrastFloors.text, above);
    const pixel = (token: PairedToken) => floored(token, contrastFloors.edge);
    const shownFg = text("fg");
    const shownFg2 = text("fg2", shownFg);
    return {
      fg: shownFg,
      fg2: shownFg2,
      dim: text("dim", shownFg2),
      sigfg: text("sigfg"),
      addfg: text("addfg"),
      delfg: text("delfg"),
      danger: text("danger"),
      working: pixel("working"),
      idle: pixel("idle"),
      signal: pixel("signal"),
      volt: pixel("volt"),
      lilac: pixel("lilac"),
    };
  };
  const paired = { raised: pairedOn("raised"), sel: pairedOn("sel"), hover: pairedOn("hover") };
  const terminalGround = over(pick("terminal.background") ?? bg, bg);
  const terminalText = pick("terminal.foreground") ?? editorForeground;
  const raw = (colour: Rgba) => hexOf(colour);
  const ansi = Object.fromEntries(
    terminalColourNames.flatMap((colourName) => {
      const colour = pick(ansiKeys[colourName]);
      return colour === undefined ? [] : [[colourName, raw(colour)]];
    }),
  );
  return {
    type,
    tokens,
    shadow: shadows[type],
    selection: raw(pick("selection.background", "editor.selectionBackground") ?? faded(0.3)),
    terminal: {
      ...ansi,
      background: hexOf(terminalGround),
      foreground: raw(terminalText),
      cursor: raw(pick("terminalCursor.foreground") ?? terminalText),
      cursorAccent: hexOf(
        over(pick("terminalCursor.background") ?? terminalGround, terminalGround),
      ),
      selectionBackground: raw(
        pick("terminal.selectionBackground", "editor.selectionBackground") ?? faded(0.3),
      ),
    },
    editor: {
      name,
      type,
      colors: Object.fromEntries([...colours].map(([key, colour]) => [key, raw(colour)])),
      tokenColors: cleanTokenColours(parsed.data.tokenColors),
    },
    overlay: { color: tokens.win, symbolColor: tokens.fg2 },
    paired,
  };
}
