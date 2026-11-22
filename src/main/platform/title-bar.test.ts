import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { titleBar } from "../../shared/title-bar.ts";
import { overlayColours, titleBarFor } from "./title-bar.ts";

const css = readFileSync(join(import.meta.dirname, "../../renderer/styles/app.css"), "utf8");

function token(block: string, name: string): string | undefined {
  return new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i").exec(block)?.[1]?.toLowerCase();
}

function themeBlocks(): { light: string; dark: string } {
  const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
  return { light: css.slice(css.indexOf(":root"), darkAt), dark: css.slice(darkAt) };
}

describe("titleBarFor", () => {
  it("keeps the traffic lights inside the strip on macOS without an overlay", () => {
    expect(titleBarFor("darwin", false)).toEqual({
      frame: "inset",
      options: { titleBarStyle: "hidden", trafficLightPosition: titleBar.trafficLights },
    });
  });

  it("draws the native controls as an overlay the height of the strip on Windows and Linux", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(titleBarFor(platform, true)).toEqual({
        frame: "overlay",
        options: {
          titleBarStyle: "hidden",
          titleBarOverlay: { ...overlayColours.dark, height: titleBar.height },
        },
      });
      expect(titleBarFor(platform, false).options.titleBarOverlay).toEqual({
        ...overlayColours.light,
        height: titleBar.height,
      });
    }
  });

  it("falls back to the native title bar on any other system", () => {
    for (const platform of ["freebsd", "openbsd", "sunos", "aix"] as const) {
      expect(titleBarFor(platform, false)).toEqual({ frame: "native", options: {} });
    }
  });

  it("colours the overlay with the side and fg2 tokens of app.css in both themes", () => {
    const blocks = themeBlocks();
    for (const theme of ["light", "dark"] as const) {
      expect(overlayColours[theme]).toEqual({
        color: token(blocks[theme], "side"),
        symbolColor: token(blocks[theme], "fg2"),
      });
    }
  });
});
