import { join } from "node:path";
import { BrowserWindow, nativeTheme } from "electron";

export async function createMainWindow(entryUrl: string): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Satellite",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#08080A" : "#FFFFFF",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  window.once("ready-to-show", () => {
    window.show();
  });
  await window.loadURL(entryUrl);
  return window;
}
