import { join } from "node:path";
import { BrowserWindow, nativeTheme } from "electron";
import { runsQuietly } from "./verification.ts";
import { secureWebPreferences } from "./web-preferences.ts";

let created: BrowserWindow | undefined;

export function mainWindow(): BrowserWindow | undefined {
  return created === undefined || created.isDestroyed() ? undefined : created;
}

export async function createMainWindow(entryUrl: string): Promise<BrowserWindow> {
  const quiet = runsQuietly();
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Satellite",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#08080A" : "#FFFFFF",
    webPreferences: {
      ...secureWebPreferences(join(import.meta.dirname, "../preload/preload.cjs")),
      backgroundThrottling: !quiet,
    },
  });
  created = window;
  if (!quiet) {
    window.once("ready-to-show", () => {
      window.show();
    });
  }
  await window.loadURL(entryUrl);
  return window;
}
