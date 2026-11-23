import { describe, expect, it } from "vitest";
import { curatedLook, curatedThemes, themeSource } from "./curated-themes.ts";
import {
  appTokens,
  contrastRatio,
  parseColour,
  terminalColourNames,
  themeLook,
} from "./theme-look.ts";

const states = {
  working: "terminal.ansiBlue",
  needsYou: "list.warningForeground",
  ready: "terminal.ansiGreen",
  done: "terminal.ansiCyan",
  idle: "terminal.ansiBrightBlack",
  danger: "errorForeground",
};
const minimal = {
  name: "minimal",
  type: "dark",
  colors: {
    "editor.background": "#101010",
    "editor.foreground": "#f0f0f0",
    "terminal.ansiBlue": "#5050ff",
    "list.warningForeground": "#ffa000",
    "terminal.ansiGreen": "#00ff00",
    "terminal.ansiCyan": "#00ffff",
    "terminal.ansiBrightBlack": "#808080",
    errorForeground: "#ff0000",
  },
  tokenColors: [],
};
const opaqueHex = /^#[0-9a-f]{6}$/;
const anyHex = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;

describe("parseColour", () => {
  it("accepts only the four hex forms and refuses anything a stylesheet could run", () => {
    expect(parseColour("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColour("#AABBCC80")).toEqual({ r: 170, g: 187, b: 204, a: 128 / 255 });
    for (const hostile of [
      "red",
      "#12345",
      "#abcg",
      " #aabbcc",
      "#aabbcc;background:url(x)",
      "url(https://example.com/x)",
      "var(--bg)",
      "rgb(1 2 3)",
      "#aabbcc\n",
      42,
      null,
      ["#aabbcc"],
    ]) {
      expect(parseColour(hostile)).toBeUndefined();
    }
  });
});

describe("themeLook", () => {
  it("maps every curated theme fully into opaque tokens, a terminal and an editor theme", () => {
    for (const { id } of curatedThemes) {
      const look = curatedLook(id);
      expect(look, id).toBeDefined();
      if (look === undefined) continue;
      for (const token of appTokens)
        expect(look.tokens[token], `${id} ${token}`).toMatch(opaqueHex);
      for (const name of terminalColourNames) expect(look.terminal[name], name).toMatch(anyHex);
      expect(look.editor.tokenColors.length).toBeGreaterThan(0);
      expect(themeSource(id)).toBe(look.type);
    }
  });

  it("takes the published values of the first curated theme for its ground, text, terminal and states", () => {
    const look = curatedLook("dracula");
    expect(look?.tokens).toMatchObject({
      bg: "#282a36",
      side: "#21222c",
      fg: "#f8f8f2",
      dim: "#6272a4",
      sel: "#44475a",
      working: "#bd93f9",
      signal: "#ffb86c",
      volt: "#50fa7b",
      lilac: "#8be9fd",
      idle: "#6272a4",
      danger: "#ff5555",
    });
    expect(look?.terminal).toMatchObject({
      background: "#282a36",
      foreground: "#f8f8f2",
      red: "#ff5555",
      brightWhite: "#ffffff",
    });
    expect(look?.editor.colors["editor.background"]).toBe("#282a36");
  });

  it("composes a colour with alpha over the ground it sits on", () => {
    const look = themeLook(
      { ...minimal, colors: { ...minimal.colors, "list.hoverBackground": "#ffffff80" } },
      states,
    );
    expect(look?.tokens.hover).toBe("#888888");
  });

  it("refuses a theme without its ground, its text or a state colour", () => {
    expect(themeLook(minimal, states)).toBeDefined();
    for (const key of ["editor.background", "editor.foreground", "errorForeground"]) {
      const colors = Object.fromEntries(Object.entries(minimal.colors).filter(([k]) => k !== key));
      expect(themeLook({ ...minimal, colors }, states), key).toBeUndefined();
    }
    for (const broken of [
      null,
      "theme",
      { ...minimal, type: "neon" },
      { ...minimal, name: "../x" },
    ]) {
      expect(themeLook(broken, states)).toBeUndefined();
    }
  });

  it("drops every colour, key, scope and font style outside the strict forms", () => {
    const look = themeLook(
      {
        ...minimal,
        colors: {
          ...minimal.colors,
          "sideBar.background": "url(https://example.com/x)",
          "list.hoverBackground": "#aabbcc;color:red",
          "bad key{": "#ffffff",
        },
        tokenColors: [
          { scope: "comment", settings: { foreground: "#6272a4", fontStyle: "italic" } },
          { scope: "string, </style><script>", settings: { foreground: "#f1fa8c" } },
          { scope: ["keyword"], settings: { foreground: "pink", fontStyle: "bold" } },
          { scope: "entity", settings: { fontStyle: "expression(alert(1))" } },
          { settings: { foreground: "#ffffff" } },
          "not an entry",
        ],
      },
      states,
    );
    expect(look?.tokens.side).toBe("#101010");
    expect(look?.editor.colors).not.toHaveProperty("sideBar.background");
    expect(look?.editor.colors).not.toHaveProperty("list.hoverBackground");
    expect(look?.editor.colors).not.toHaveProperty("bad key{");
    expect(look?.editor.tokenColors).toEqual([
      { scope: ["comment"], settings: { foreground: "#6272a4", fontStyle: "italic" } },
      { scope: ["string"], settings: { foreground: "#f1fa8c" } },
      { scope: ["keyword"], settings: { fontStyle: "bold" } },
    ]);
  });
});

describe("contrastRatio", () => {
  it("measures with the WCAG formula", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
