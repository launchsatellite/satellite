import { join } from "node:path";
import { BrowserWindow, nativeTheme } from "electron";
import { secureWebPreferences } from "./web-preferences.ts";

let created: BrowserWindow | undefined;

export function mainWindow(): BrowserWindow | undefined {
  return created === undefined || created.isDestroyed() ? undefined : created;
}

export async function createMainWindow(entryUrl: string): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Satellite",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#08080A" : "#FFFFFF",
    webPreferences: secureWebPreferences(join(import.meta.dirname, "../preload/preload.cjs")),
  });
  created = window;
  window.once("ready-to-show", () => {
    window.show();
  });
  await window.loadURL(entryUrl);
  return window;
}
