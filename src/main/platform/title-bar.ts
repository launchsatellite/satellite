import type { BaseWindowConstructorOptions, TitleBarOverlayOptions } from "electron";
import type { TitleBarFrame } from "../../shared/bridge-contract.ts";
import { titleBar } from "../../shared/title-bar.ts";

export interface TitleBarSetup {
  frame: TitleBarFrame;
  options: Pick<
    BaseWindowConstructorOptions,
    "titleBarStyle" | "titleBarOverlay" | "trafficLightPosition"
  >;
}

export const overlayColours = {
  light: { color: "#f6f6f3", symbolColor: "#45454b" },
  dark: { color: "#0c0c0e", symbolColor: "#b4b4b8" },
};

export function overlayStyle(dark: boolean): TitleBarOverlayOptions {
  return { ...overlayColours[dark ? "dark" : "light"], height: titleBar.height - 1 };
}

export function titleBarFor(platform: NodeJS.Platform, dark: boolean): TitleBarSetup {
  if (platform === "darwin") {
    return {
      frame: "inset",
      options: { titleBarStyle: "hidden", trafficLightPosition: titleBar.trafficLights },
    };
  }
  if (platform === "win32" || platform === "linux") {
    return {
      frame: "overlay",
      options: { titleBarStyle: "hidden", titleBarOverlay: overlayStyle(dark) },
    };
  }
  return { frame: "native", options: {} };
}

export function titleBarSetup(dark: boolean): TitleBarSetup {
  return titleBarFor(process.platform, dark);
}
