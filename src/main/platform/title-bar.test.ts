import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { curatedLook, curatedThemes } from "../../shared/themes/curated-themes.ts";
import { overlayColours, overlayStyle, titleBarFor } from "./title-bar.ts";

const css = readFileSync(join(import.meta.dirname, "../../renderer/styles/app.css"), "utf8");

function token(block: string, name: string): string | undefined {
  return new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i").exec(block)?.[1]?.toLowerCase();
}

describe("titleBarFor", () => {
  it("keeps the system title bar on a system without a documented integrated one", () => {
    for (const platform of ["freebsd", "openbsd", "sunos", "aix"] as const) {
      expect(titleBarFor(platform, "system", false)).toEqual({ frame: "native", options: {} });
    }
  });

  it("colours the overlay with the side and fg2 tokens of app.css in both themes", () => {
    const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
    const blocks = { light: css.slice(css.indexOf(":root"), darkAt), dark: css.slice(darkAt) };
    for (const theme of ["light", "dark"] as const) {
      expect(overlayColours[theme]).toEqual({
        color: token(blocks[theme], "side"),
        symbolColor: token(blocks[theme], "fg2"),
      });
    }
  });
});

describe("overlayStyle", () => {
  it("colours the overlay with a curated theme's side and fg2 whatever the system says", () => {
    for (const { id } of curatedThemes) {
      const tokens = curatedLook(id)?.tokens;
      for (const dark of [false, true]) {
        expect(overlayStyle(id, dark)).toMatchObject({
          color: tokens?.side,
          symbolColor: tokens?.fg2,
        });
      }
    }
  });

  it("falls back to the plain dark overlay for a curated theme that does not map", () => {
    for (const { id } of curatedThemes) {
      expect(overlayStyle(id, false, () => undefined)).toMatchObject(overlayColours.dark);
    }
  });

  it("follows the system for Satellite's own themes", () => {
    expect(overlayStyle("system", true)).toMatchObject(overlayColours.dark);
    expect(overlayStyle("light", false)).toMatchObject(overlayColours.light);
  });
});
