import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BrowserWindow, app, session } from "electron";
import { registerBridge } from "./bridge/bridge-ipc.ts";
import { chooseFolder } from "./platform/folder-dialog.ts";
import { treeKillBoundMs } from "./platform/process-tree.ts";
import { prepareSatelliteHome } from "./platform/satellite-home.ts";
import { createProjects, type Projects } from "./projects/project-list.ts";
import {
  createInterfaceFile,
  interfaceHandlers,
  type InterfaceFile,
} from "./state/interface-file.ts";
import { createTerminalSessions } from "./terminal/terminal-sessions.ts";
import { checkTools } from "./tools/tool-check.ts";
import {
  appOrigin,
  handleAppProtocol,
  registerAppScheme,
  rendererEntryUrl,
} from "./window/app-protocol.ts";
import { installAppMenu } from "./window/app-menu.ts";
import { hardenSession, hardenWebContents } from "./window/hardening.ts";
import { createMainWindow, mainWindow } from "./window/main-window.ts";
import { applyThemeChoice } from "./window/theme.ts";

const terminals = createTerminalSessions();
const quitBoundMs = treeKillBoundMs + 500;
let quitting = false;

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

async function start(interfaceFile: InterfaceFile, projects: Projects): Promise<void> {
  await app.whenReady();
  applyThemeChoice((await interfaceFile.load()).state.theme);
  const entryUrl = rendererEntryUrl();
  installAppMenu();
  hardenSession(session.defaultSession);
  hardenWebContents(entryUrl);
  handleAppProtocol(join(app.getAppPath(), "out/renderer"));
  registerBridge(
    {
      "tools.check": checkTools,
      ...interfaceHandlers(interfaceFile, applyThemeChoice),
      ...projects.handlers,
      ...terminals.handlers,
    },
    allowedOrigin(entryUrl),
  );
  await createMainWindow(entryUrl);
}

function failStart(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Satellite could not start and is quitting. ${reason}`);
  app.exit(1);
}

function prepareHome(): string | undefined {
  try {
    const home = prepareSatelliteHome();
    app.setPath("userData", join(home, "app-data"));
    return home;
  } catch (error) {
    failStart(error);
    return undefined;
  }
}

const home = prepareHome();
const interfaceFile = home === undefined ? undefined : createInterfaceFile(home);
const projects =
  home === undefined ? undefined : createProjects({ home, chooseFolder, window: mainWindow });
if (interfaceFile !== undefined && projects !== undefined && app.requestSingleInstanceLock()) {
  registerAppScheme();
  app.on("second-instance", focusMainWindow);
  start(interfaceFile, projects).catch(failStart);
} else if (home !== undefined) {
  app.exit(0);
}

app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  const settled = Promise.all([terminals.closeAll(), interfaceFile?.flush(), projects?.flush()]);
  void Promise.race([settled, delay(quitBoundMs)]).finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
