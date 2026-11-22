import { join } from "node:path";
import { app, BrowserWindow, dialog, nativeTheme } from "electron";
import { overlayStyle, titleBarSetup } from "../platform/title-bar.ts";
import { quitButton, quitQuestion } from "./quit-question.ts";
import { runsQuietly } from "./verification.ts";
import { secureWebPreferences } from "./web-preferences.ts";
import { setWindowFrame } from "./window-frame.ts";

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

export async function askToQuit(sessions: number): Promise<boolean> {
  const window = mainWindow();
  if (sessions === 0 || window === undefined) return true;
  const { response } = await dialog.showMessageBox(window, quitQuestion(sessions));
  return response === quitButton;
}

export async function createMainWindow(
  entryUrl: string,
  leaving: () => boolean,
): Promise<BrowserWindow> {
  const quiet = runsQuietly();
  const titleBar = titleBarSetup(nativeTheme.shouldUseDarkColors);
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Satellite",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#08080A" : "#FFFFFF",
    ...titleBar.options,
    webPreferences: {
      ...secureWebPreferences(join(import.meta.dirname, "../preload/preload.cjs")),
      backgroundThrottling: !quiet,
    },
  });
  created = window;
  window.setMenuBarVisibility(false);
  const frame = (fullScreen: boolean) => {
    setWindowFrame({ frame: titleBar.frame, fullScreen });
  };
  frame(window.isFullScreen());
  window.on("enter-full-screen", () => {
    frame(true);
  });
  window.on("leave-full-screen", () => {
    frame(false);
  });
  if (titleBar.frame === "overlay") {
    const recolour = () => {
      if (!window.isDestroyed()) window.setTitleBarOverlay(overlayStyle(nativeTheme.shouldUseDarkColors));
    };
    nativeTheme.on("updated", recolour);
    window.once("closed", () => {
      nativeTheme.off("updated", recolour);
    });
  }
  window.on("close", (event) => {
    if (leaving()) return;
    event.preventDefault();
    app.quit();
  });
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
