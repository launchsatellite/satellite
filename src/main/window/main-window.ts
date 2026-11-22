import { join } from "node:path";
import { app, BrowserWindow, dialog, nativeTheme } from "electron";
import { runsQuietly } from "./verification.ts";
import { secureWebPreferences } from "./web-preferences.ts";

let created: BrowserWindow | undefined;

export function mainWindow(): BrowserWindow | undefined {
  return created === undefined || created.isDestroyed() ? undefined : created;
}

export function bringToFront(): void {
  const window = mainWindow();
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function windowInFront(): boolean {
  const window = mainWindow();
  return window !== undefined && window.isVisible() && !window.isMinimized() && window.isFocused();
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
  let reloaded = false;
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit" || window.isDestroyed()) return;
    if (!reloaded) {
      reloaded = true;
      void window.loadURL(entryUrl);
      return;
    }
    void dialog
      .showMessageBox(window, {
        type: "error",
        message: "Satellite's window stopped working again",
        detail: "Your Claude Code sessions ended with it. Quit, then open Satellite again.",
        buttons: ["Quit Satellite"],
      })
      .then(() => {
        app.quit();
      });
  });
  await window.loadURL(entryUrl);
  return window;
}
