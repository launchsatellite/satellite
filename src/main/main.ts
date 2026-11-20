import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BrowserWindow, app, session } from "electron";
import { registerBridge } from "./bridge/bridge-ipc.ts";
import { prepareSatelliteHome } from "./platform/satellite-home.ts";
import { createTerminalSessions } from "./terminal/terminal-sessions.ts";
import { toolVersions } from "./tools/tool-versions.ts";
import {
  appOrigin,
  handleAppProtocol,
  registerAppScheme,
  rendererEntryUrl,
} from "./window/app-protocol.ts";
import { installAppMenu } from "./window/app-menu.ts";
import { hardenSession, hardenWebContents } from "./window/hardening.ts";
import { createMainWindow } from "./window/main-window.ts";

function allowedOrigin(entryUrl: string): string {
  return entryUrl.startsWith(`${appOrigin}/`) ? appOrigin : new URL(entryUrl).origin;
}

function focusMainWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

const terminals = createTerminalSessions();
const quitBoundMs = 2500;
let quitting = false;

async function start(): Promise<void> {
  await app.whenReady();
  const entryUrl = rendererEntryUrl();
  installAppMenu();
  hardenSession(session.defaultSession);
  hardenWebContents(entryUrl);
  handleAppProtocol(join(app.getAppPath(), "out/renderer"));
  registerBridge(
    {
      "tools.versions": toolVersions,
      ...terminals.handlers,
    },
    allowedOrigin(entryUrl),
  );
  await createMainWindow(entryUrl);
}

app.setPath("userData", join(prepareSatelliteHome(), "app-data"));
registerAppScheme();

if (app.requestSingleInstanceLock()) {
  app.on("second-instance", focusMainWindow);
  start().catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Satellite could not open its window and is quitting. ${reason}`);
    app.exit(1);
  });
} else {
  app.exit(0);
}

app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void Promise.race([terminals.closeAll(), delay(quitBoundMs)]).finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
