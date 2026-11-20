import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BrowserWindow, app, session } from "electron";
import { registerBridge } from "./bridge/bridge-ipc.ts";
import { chooseFolder } from "./platform/folder-dialog.ts";
import { prepareSatelliteHome } from "./platform/satellite-home.ts";
import { createProjects, type Projects } from "./projects/project-list.ts";
import { startHookListener, type HookListener } from "./sessions/hook-listener.ts";
import { createLastSessions, type LastSessions } from "./sessions/last-sessions.ts";
import { sessionFolder } from "./sessions/session-folder.ts";
import {
  createInterfaceFile,
  interfaceHandlers,
  type InterfaceFile,
} from "./state/interface-file.ts";
import { linkHandlers } from "./terminal/link-handlers.ts";
import {
  createTerminalSessions,
  quitBoundMs,
  type TerminalSessions,
} from "./terminal/terminal-sessions.ts";
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
import { workspaceHandlers, type Workspaces } from "./workspaces/workspace-handlers.ts";
import { prepareVerification } from "./window/verification.ts";
import { applyThemeChoice } from "./window/theme.ts";

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

interface Parts {
  interfaceFile: InterfaceFile;
  last: LastSessions;
  listening: Promise<HookListener | undefined>;
  projects: Projects;
  terminals: TerminalSessions;
  workspaces: Workspaces;
}

async function start({
  interfaceFile,
  listening,
  projects,
  terminals,
  workspaces,
}: Parts): Promise<void> {
  await app.whenReady();
  await listening;
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
      ...workspaces.handlers,
      ...terminals.handlers,
      ...linkHandlers(),
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

function assemble(home: string): Parts {
  const last = createLastSessions(home);
  const listening = startHookListener((launchId, event, sessionId) => {
    terminals.hookEvent(launchId, event, sessionId);
  }).catch((error: unknown) => {
    console.error(
      "Satellite could not listen for Claude Code's status, so sessions stay idle",
      error,
    );
    return undefined;
  });
  const projects = createProjects({
    home,
    chooseFolder,
    window: mainWindow,
    stopSessions: (folder) => terminals.sessionsInside.stopInside(folder),
    recorded: (list) => {
      void last.keepOnly(
        list.flatMap((project) => [
          { projectId: project.id, workspace: "main" },
          ...project.workspaces.map(({ id }) => ({ projectId: project.id, workspace: id })),
        ]),
      );
    },
  });
  const terminals = createTerminalSessions({
    home,
    folder: (ref) => sessionFolder(home, projects.store, ref),
    listener: listening,
    last,
  });
  return {
    interfaceFile: createInterfaceFile(home),
    last,
    listening,
    projects,
    terminals,
    workspaces: workspaceHandlers({
      home,
      store: projects.store,
      sessions: terminals.sessionsInside,
    }),
  };
}

prepareVerification();
const home = prepareHome();
const parts = home === undefined ? undefined : assemble(home);
if (parts !== undefined && app.requestSingleInstanceLock()) {
  registerAppScheme();
  app.on("second-instance", focusMainWindow);
  start(parts).catch(failStart);
} else if (home !== undefined) {
  app.exit(0);
}

app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  const bounded = (work: Promise<unknown>) => Promise.race([work, delay(quitBoundMs)]);
  const settled = Promise.all([
    bounded(
      Promise.all([parts?.terminals.closeAll(), parts?.last.flush(), parts?.interfaceFile.flush()]),
    ),
    (parts?.workspaces.stopAll() ?? Promise.resolve()).then(() =>
      bounded(parts?.projects.flush() ?? Promise.resolve()),
    ),
  ]);
  void settled.finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
