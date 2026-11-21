import { join } from "node:path";
import { app, session } from "electron";
import type { InterfaceState } from "../shared/bridge-contract.ts";
import { registerBridge } from "./bridge/bridge-ipc.ts";
import { createChanges, type Changes } from "./changes/changes-handlers.ts";
import { noticeSubject } from "./inbox/notice-subject.ts";
import { createNotices, type Notices } from "./inbox/notices.ts";
import { chooseFolder } from "./platform/folder-dialog.ts";
import { prepareSatelliteHome } from "./platform/satellite-home.ts";
import {
  prepareSystemNotices,
  recordedLines,
  setAppBadge,
  showNotice,
  windowCountsInFront,
  windowTookFocus,
} from "./platform/system-notices.ts";
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
import { bringToFront, createMainWindow, mainWindow, windowInFront } from "./window/main-window.ts";
import { workspaceHandlers, type Workspaces } from "./workspaces/workspace-handlers.ts";
import { createQuitGate } from "./window/quit-gate.ts";
import { settleForQuit } from "./window/quit-settle.ts";
import { prepareVerification } from "./window/verification.ts";
import { applyThemeChoice } from "./window/theme.ts";

function allowedOrigin(entryUrl: string): string {
  return entryUrl.startsWith(`${appOrigin}/`) ? appOrigin : new URL(entryUrl).origin;
}

interface Parts {
  changes: Changes;
  interfaceFile: InterfaceFile;
  last: LastSessions;
  listening: Promise<HookListener | undefined>;
  notices: Notices;
  projects: Projects;
  recorder: { flush(): Promise<void> };
  terminals: TerminalSessions;
  workspaces: Workspaces;
}

async function start({
  changes,
  interfaceFile,
  listening,
  notices,
  projects,
  terminals,
  workspaces,
}: Parts): Promise<void> {
  await app.whenReady();
  prepareSystemNotices();
  await listening;
  const applyInterface = (state: InterfaceState) => {
    applyThemeChoice(state.theme);
    notices.setEnabled(state.notifications);
  };
  applyInterface((await interfaceFile.load()).state);
  const entryUrl = rendererEntryUrl();
  installAppMenu();
  hardenSession(session.defaultSession);
  hardenWebContents(entryUrl);
  handleAppProtocol(join(app.getAppPath(), "out/renderer"));
  registerBridge(
    {
      "tools.check": checkTools,
      ...interfaceHandlers(interfaceFile, applyInterface),
      ...projects.handlers,
      ...workspaces.handlers,
      ...terminals.handlers,
      ...changes.handlers,
      ...linkHandlers(),
    },
    allowedOrigin(entryUrl),
  );
  const window = await createMainWindow(entryUrl);
  window.on("focus", () => {
    windowTookFocus(() => {
      notices.seen();
    });
  });
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
    stopSessions: (folder) => sessionsInside.stopInside(folder),
    recorded: (list) => {
      void last.keepOnly(
        list.flatMap((project) => [
          { projectId: project.id, workspace: "main" },
          ...project.workspaces.map(({ id }) => ({ projectId: project.id, workspace: id })),
        ]),
      );
    },
  });
  const notices = createNotices({
    inFront: () => windowCountsInFront(windowInFront),
    subject: (ref) => noticeSubject(projects.store, ref),
    show: showNotice,
    setBadge: setAppBadge,
    open: ({ workspace, owner }) => {
      bringToFront();
      owner.emit("notices.open", { workspace });
    },
  });
  const terminals = createTerminalSessions({
    home,
    folder: (ref) => sessionFolder(home, projects.store, ref),
    listener: listening,
    last,
    onNeeding: (needing) => {
      notices.update(needing);
    },
  });
  const changes = createChanges({ home, store: projects.store });
  const sessionsInside = {
    countInside: (folder: string) => terminals.sessionsInside.countInside(folder),
    stopInside: async (folder: string) => {
      await Promise.all([terminals.sessionsInside.stopInside(folder), changes.stopInside(folder)]);
    },
  };
  return {
    changes,
    interfaceFile: createInterfaceFile(home),
    last,
    listening,
    notices,
    projects,
    recorder: { flush: recordedLines },
    terminals,
    workspaces: workspaceHandlers({
      home,
      store: projects.store,
      sessions: sessionsInside,
    }),
  };
}

prepareVerification();
const home = prepareHome();
const parts = home === undefined ? undefined : assemble(home);
if (parts !== undefined && app.requestSingleInstanceLock()) {
  registerAppScheme();
  app.on("second-instance", bringToFront);
  start(parts).catch(failStart);
} else if (home !== undefined) {
  app.exit(0);
}

app.on(
  "before-quit",
  createQuitGate(
    () => settleForQuit(parts, quitBoundMs),
    () => {
      app.quit();
    },
  ),
);

app.on("window-all-closed", () => {
  app.quit();
});
