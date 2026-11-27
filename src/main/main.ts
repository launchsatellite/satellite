import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { app, dialog, session } from "electron";
import type { InterfaceState } from "../shared/bridge-contract.ts";
import { registerBridge } from "./bridge/bridge-ipc.ts";
import { createChanges, type Changes } from "./changes/changes-handlers.ts";
import { protectHome } from "./changes/file-sides.ts";
import { createFiles, type Files } from "./files/files-handlers.ts";
import { noticeSubject } from "./inbox/notice-subject.ts";
import { createNotices, type Needing, type Notices } from "./inbox/notices.ts";
import { chooseFolder } from "./platform/folder-dialog.ts";
import { prepareSatelliteHome, satelliteHome } from "./platform/satellite-home.ts";
import {
  prepareSystemNotices,
  recordedLines,
  setAppBadge,
  showNotice,
  windowCountsInFront,
  windowTookFocus,
} from "./platform/system-notices.ts";
import { createProcesses, type Processes } from "./processes/processes-handlers.ts";
import { createProjects, type Projects } from "./projects/project-list.ts";
import { createPullRequests, type PullRequests } from "./pull-request/pull-request-reads.ts";
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
import {
  askToQuit,
  bringToFront,
  createMainWindow,
  mainWindow,
  showTheme,
  windowInFront,
} from "./window/main-window.ts";
import { windowFrameHandlers } from "./window/window-frame.ts";
import { createWatch, type Watch } from "./watch/watch-service.ts";
import { forkWatcher } from "./watch/watcher-child.ts";
import { workspaceHandlers, type Workspaces } from "./workspaces/workspace-handlers.ts";
import { createQuitGate } from "./window/quit-gate.ts";
import type { QuitFacts } from "./window/quit-question.ts";
import { settleForQuit } from "./window/quit-settle.ts";
import { prepareVerification, underVerification } from "./window/verification.ts";

function allowedOrigin(entryUrl: string): string {
  return entryUrl.startsWith(`${appOrigin}/`) ? appOrigin : new URL(entryUrl).origin;
}

interface Parts {
  changes: Changes;
  files: Files;
  interfaceFile: InterfaceFile;
  last: LastSessions;
  listening: Promise<HookListener | undefined>;
  notices: Notices;
  processes: Processes;
  projects: Projects;
  pullRequests: PullRequests;
  recorder: { flush(): Promise<void> };
  terminals: TerminalSessions;
  watch: Watch;
  workspaces: Workspaces;
}

const ptyKillAgent = "conpty_console_list_agent";
const quitReadMs = 2000;

let leaving = false;

async function quitFacts({ terminals, processes }: Parts): Promise<QuitFacts> {
  const states = terminals.quitStates();
  if (states.sessions === 0) return { ...states, processes: 0 };
  const counted = await Promise.race([
    processes.count().catch(() => null),
    delay(quitReadMs, null, { ref: false }),
  ]);
  return { ...terminals.quitStates(), processes: counted };
}

async function start({
  changes,
  files,
  interfaceFile,
  listening,
  notices,
  processes,
  projects,
  pullRequests,
  terminals,
  watch,
  workspaces,
}: Parts): Promise<void> {
  await app.whenReady();
  prepareSystemNotices();
  await listening;
  const applyInterface = (state: InterfaceState) => {
    showTheme(state.theme);
    notices.setEnabled(state.notifications);
  };
  applyInterface((await interfaceFile.load()).state);
  const entryUrl = rendererEntryUrl();
  installAppMenu();
  await hardenSession(session.defaultSession, entryUrl);
  hardenWebContents(entryUrl);
  handleAppProtocol(join(app.getAppPath(), "out/renderer"));
  registerBridge(
    {
      "tools.check": checkTools,
      ...interfaceHandlers(interfaceFile, applyInterface, async () => {
        const recorded = await projects.store.list();
        return new Set(
          recorded.flatMap(({ id, workspaces }) => [
            `${id}/main`,
            ...workspaces.map((workspace) => `${id}/${workspace.id}`),
          ]),
        );
      }),
      ...projects.handlers,
      ...workspaces.handlers,
      ...terminals.handlers,
      ...changes.handlers,
      ...files.handlers,
      ...pullRequests.handlers,
      ...processes.handlers,
      ...linkHandlers(),
      ...windowFrameHandlers,
      ...watch.handlers,
    },
    allowedOrigin(entryUrl),
  );
  const window = await createMainWindow(entryUrl, () => leaving);
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
  let folder = process.env["SATELLITE_HOME"] ?? "";
  try {
    folder = satelliteHome();
    const home = prepareSatelliteHome(folder);
    app.setPath("userData", join(home, "app-data"));
    return home;
  } catch (error) {
    if (!underVerification()) {
      dialog.showErrorBox(
        "Satellite couldn't prepare its home",
        `Satellite keeps your projects and workspaces in ${folder} and couldn't make that folder ready, so it is quitting.\n\n${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
  const watch = createWatch({ fork: forkWatcher });
  const projects = createProjects({
    home,
    chooseFolder,
    window: mainWindow,
    stopSessions: (folder) => sessionsInside.stopInside(folder),
    recorded: (list) => {
      watch.watchProjects(list);
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
  let needingSessions: readonly Needing[] = [];
  let needingPullRequests: readonly Needing[] = [];
  const terminals = createTerminalSessions({
    home,
    folder: (ref) => sessionFolder(home, projects.store, ref),
    listener: listening,
    last,
    onNeeding: (needing) => {
      needingSessions = needing;
      notices.update([...needingSessions, ...needingPullRequests]);
    },
  });
  const pullRequests = createPullRequests({
    home,
    store: projects.store,
    sweepEveryMs: 60_000,
    onNeeding: (needing) => {
      needingPullRequests = needing;
      notices.update([...needingSessions, ...needingPullRequests]);
    },
  });
  protectHome(home);
  const processes = createProcesses({ roots: () => terminals.roots() });
  const changes = createChanges({ home, store: projects.store });
  const files = createFiles({ home, store: projects.store });
  const sessionsInside = {
    countInside: (folder: string) => terminals.sessionsInside.countInside(folder),
    stopInside: async (folder: string) => {
      await Promise.all([
        terminals.sessionsInside.stopInside(folder),
        changes.stopInside(folder),
        files.stopInside(folder),
        pullRequests.stopInside(folder),
      ]);
    },
  };
  return {
    changes,
    files,
    interfaceFile: createInterfaceFile(home),
    last,
    listening,
    notices,
    processes,
    projects,
    pullRequests,
    recorder: { flush: recordedLines },
    terminals,
    watch,
    workspaces: workspaceHandlers({
      home,
      store: projects.store,
      sessions: sessionsInside,
    }),
  };
}

prepareVerification();
const home = prepareHome();
const locked = home !== undefined && app.requestSingleInstanceLock();
const parts = home === undefined || !locked ? undefined : assemble(home);
if (parts !== undefined) {
  registerAppScheme();
  app.on("second-instance", (_event, argv) => {
    if (!argv.some((arg) => arg.includes(ptyKillAgent))) bringToFront();
  });
  start(parts).catch(failStart);
} else if (home !== undefined) {
  app.exit(0);
}

app.on(
  "before-quit",
  createQuitGate(
    async () => parts === undefined || askToQuit(await quitFacts(parts)),
    () => settleForQuit(parts, quitBoundMs),
    () => {
      leaving = true;
      app.quit();
    },
  ),
);

app.on("will-quit", () => {
  parts?.watch.stop();
});

app.on("window-all-closed", () => {
  app.quit();
});
