import type { BaseWindowConstructorOptions, TitleBarOverlayOptions } from "electron";
import type { TitleBarFrame } from "../../shared/bridge-contract.ts";
import { curatedLook, curatedTheme } from "../../shared/themes/curated-themes.ts";
import { titleBar } from "../../shared/title-bar.ts";

export interface TitleBarSetup {
  frame: TitleBarFrame;
  options: Pick<
    BaseWindowConstructorOptions,
    "titleBarStyle" | "titleBarOverlay" | "trafficLightPosition"
  >;
}

export const overlayColours = {
  light: { color: "#f1f1ee", symbolColor: "#45454b" },
  dark: { color: "#0c0c0e", symbolColor: "#b4b4b8" },
};

export function overlayStyle(
  theme: string,
  dark: boolean,
  lookOf = curatedLook,
): TitleBarOverlayOptions {
  const curated = curatedTheme(theme) !== undefined;
  const colours = lookOf(theme)?.overlay ?? overlayColours[dark || curated ? "dark" : "light"];
  return { ...colours, height: titleBar.height - 1 };
}

export function titleBarFor(
  platform: NodeJS.Platform,
  theme: string,
  dark: boolean,
): TitleBarSetup {
  if (platform === "darwin") {
    return {
      frame: "inset",
      options: { titleBarStyle: "hidden", trafficLightPosition: titleBar.trafficLights },
    };
  }
  if (platform === "win32" || platform === "linux") {
    return {
      frame: "overlay",
      options: { titleBarStyle: "hidden", titleBarOverlay: overlayStyle(theme, dark) },
    };
  }
  return { frame: "native", options: {} };
}

export function titleBarSetup(theme: string, dark: boolean): TitleBarSetup {
  return titleBarFor(process.platform, theme, dark);
}
