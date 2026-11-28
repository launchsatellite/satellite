import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  interfaceLimits,
  type ChangesView as ChangesShown,
  type InterfaceState,
  type ProjectView,
  type ThemeChoice,
  type WindowFrame,
  type WorkspaceKey,
  type WorkspaceRef,
  type WorkspaceView,
} from "../../shared/bridge-contract.ts";
import { subscribe } from "../bridge/bridge-client.ts";
import { ChangesView, type Picked } from "../changes/changes-view.tsx";
import { sideOnly, type ShownText } from "../changes/file-diff.tsx";
import { conflictRequest, lineReference, noLinesSentence } from "../changes/prompt-requests.ts";
import { useChanges } from "../changes/use-changes.ts";
import { useDiffSelection } from "../changes/use-diff-selection.ts";
import { FilesView } from "../files/files-view.tsx";
import { sendToClaudeCode } from "../sessions/send-to-claude-code.ts";
import { createCommandRegistry, type Command } from "../commands/command-registry.ts";
import { CommandsProvider } from "../commands/commands-context.tsx";
import { GuideLayer } from "../guide/guide-layer.tsx";
import {
  guideClosedSentence,
  guideWaitsForToolsSentence,
  guideWaitsSentence,
} from "../guide/guide-steps.ts";
import { useGuide } from "../guide/use-guide.ts";
import { InboxList } from "../inbox/inbox-list.tsx";
import { inboxReasons, inboxRows, noticeTarget, type InboxTarget } from "../inbox/inbox.ts";
import { fileLinesRequest } from "../files/file-lines.ts";
import { notTextSentence } from "../files/file-words.ts";
import type { ShownFile } from "../files/files-view.tsx";
import { useFileSearch } from "../files/use-file-search.ts";
import { useFileTabs } from "../files/use-file-tabs.ts";
import { ProcessesDialog } from "../processes/processes-dialog.tsx";
import { portLinkSentence } from "../processes/process-words.ts";
import { useProcesses } from "../processes/use-processes.ts";
import { Palette, type PaletteMode, type SwitcherItem } from "../palette/palette.tsx";
import { focusColumn } from "./focus-column.ts";
import { DropOverlay, useFolderDrop } from "../projects/drop-overlay.tsx";
import { Sidebar } from "../projects/sidebar.tsx";
import { ChecksList } from "../pull-request/checks-list.tsx";
import { ConversationList } from "../pull-request/conversation-list.tsx";
import { PullRequestOverview } from "../pull-request/pull-request-overview.tsx";
import { PullRequestFiles } from "../pull-request/pull-request-files.tsx";
import { PullRequestView, type PullRequestSection } from "../pull-request/pull-request-view.tsx";
import { linkSentence } from "../pull-request/pull-request-words.ts";
import { useThreadJump } from "../pull-request/use-thread-jump.ts";
import { foundOf, usePullRequests } from "../pull-request/use-pull-requests.ts";
import { repeatedNames, shownParent } from "../../shared/project-names.ts";
import { curatedThemes } from "../../shared/themes/curated-themes.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { useProjects, workspaceLabel } from "../projects/use-projects.ts";
import { RemoveProjectDialog } from "../projects/remove-project-dialog.tsx";
import { runningHere } from "../projects/running-here.ts";
import { WorkspaceHeader } from "../projects/workspace-header.tsx";
import { agentList, type AgentItem } from "../sessions/agent-list.ts";
import { focusSession } from "../sessions/focus-session.ts";
import { LinkDialog } from "../sessions/link-dialog.tsx";
import { SessionsPane } from "../sessions/sessions-pane.tsx";
import { tabLimitSentence, useSessions } from "../sessions/use-sessions.ts";
import { SettingsDialog } from "../settings/settings-dialog.tsx";
import { ToolCheckCard } from "../setup/tool-check.tsx";
import { showTheme } from "../ui/shown-theme.ts";
import { Toast, type Notify } from "../ui/toast.tsx";
import { afterDismiss, withToast, type QueuedToast } from "./toast-queue.ts";
import { ArchiveDialog } from "../workspaces/archive-dialog.tsx";
import { NewWorkspaceDialog } from "../workspaces/new-workspace-dialog.tsx";
import { Rail, type RailView } from "../rail/rail.tsx";
import type { CentreFiles } from "../sessions/session-tabs.tsx";
import { ColumnDivider } from "./column-divider.tsx";
import { fitColumns, railFoldsBelow, reachableColumns, type RailShape } from "./columns.ts";
import { FolderMissing, NothingSelected } from "./empty-states.tsx";
import { useInterfaceState } from "./interface-state.ts";
import { TitleBar } from "./title-bar.tsx";

type CommandSpec = Omit<Command, "run"> & { run: () => void | Promise<void> };

interface AppWindowProps {
  initial: InterfaceState;
  frame: WindowFrame | null;
  notice: string | null;
}

const commandFailure = "Satellite couldn't finish that. Try again.";
const terminalLinkSentence =
  "The text Claude Code showed points to this address. Check it before you open it.";
const notificationsOff = "Notifications are off. The inbox still shows what needs you.";
const notificationsOn = "Notifications are on for every workspace that needs you.";
const sidebarId = "sidebar";

function firstVisible(selectors: readonly string[]): HTMLElement | undefined {
  for (const selector of selectors) {
    const found = [...document.querySelectorAll<HTMLElement>(selector)].find((element) =>
      element.checkVisibility(),
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

function forgotSentence(name: string, workspaces: number, worktrees: string | undefined): string {
  if (workspaces === 0) return `Satellite removed ${name}. Its folder is untouched.`;
  const counted = workspaces === 1 ? "1 workspace" : `${String(workspaces)} workspaces`;
  const kept =
    worktrees === undefined
      ? "Every folder stays where it is."
      : workspaces === 1
        ? `The workspace's folder stays in ${worktrees} in the Satellite home.`
        : `The workspaces' folders stay in ${worktrees} in the Satellite home.`;
  return `Satellite removed ${name} and its ${counted}. ${kept}`;
}

function archivedSentence(name: string, branch: string | null, leftover: string | null): string {
  if (leftover !== null) {
    return `Satellite archived ${name}, but some files couldn't be deleted and stayed in ${leftover} in the Satellite home.`;
  }
  return branch === null
    ? `Satellite archived ${name}.`
    : `Satellite archived ${name}. The branch ${branch} stays.`;
}

function guarded(specs: readonly CommandSpec[], notify: Notify, modal: boolean): Command[] {
  const fail = (error: unknown) => {
    console.error("A command failed", error);
    notify(commandFailure, "error");
  };
  return specs.map((spec) => ({
    ...spec,
    available: spec.available && !modal,
    run: () => {
      try {
        void Promise.resolve(spec.run()).catch(fail);
      } catch (error) {
        fail(error);
      }
    },
  }));
}

export function AppWindow({ initial, frame, notice }: AppWindowProps) {
  const [toasts, setToasts] = useState<QueuedToast[]>(() =>
    notice === null ? [] : [{ id: 1, message: notice, tone: "notice", queuedAt: Date.now() }],
  );
  const notify = useCallback<Notify>((message, tone) => {
    setToasts((queue) => withToast(queue, message, tone, Date.now()));
  }, []);
  const dismissToast = useCallback(() => {
    setToasts((queue) => afterDismiss(queue, Date.now()));
  }, []);
  const toast = toasts[0];
  const { state, update } = useInterfaceState(initial, notify);
  const { projects, add, drop, remove, move, upsertWorkspace, dropWorkspace, refresh } =
    useProjects(notify);
  const sessions = useSessions(notify);
  const {
    open: openSession,
    close: closeSession,
    activate: activateSession,
    forgetWorkspace,
    forgetGone,
    forgetProject,
  } = sessions;
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<{
    project: ProjectView;
    workspace: WorkspaceView;
  } | null>(null);
  const [removing, setRemoving] = useState<{
    projectId: string;
    name: string;
    worktrees: string | undefined;
    sessions: number;
    processes: number;
  } | null>(null);
  const [added, setAdded] = useState<string>();
  const [processesOpen, setProcessesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [asking, setAsking] = useState<{ address: string; description: string } | null>(null);
  const askTerminalLink = useCallback((address: string) => {
    setAsking({ address, description: terminalLinkSentence });
  }, []);
  const askPullRequestLink = useCallback((address: string) => {
    setAsking({ address, description: linkSentence });
  }, []);
  const closeProcesses = useCallback(() => {
    setProcessesOpen(false);
  }, []);
  const closeLink = useCallback(() => {
    setAsking(null);
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);
  const askAboutLink = useCallback((address: string, description: string) => {
    setAsking({ address, description });
  }, []);
  const windowRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const centreRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  const [railUnfolded, setRailUnfolded] = useState(false);
  useLayoutEffect(() => {
    showTheme(state.theme);
  }, [state.theme]);
  useEffect(() => {
    const element = windowRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setWidth(entry.contentRect.width);
      if (entry.contentRect.width >= railFoldsBelow) setRailUnfolded(false);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const selectedId = state.selected?.projectId;
  const selectedKey = state.selected?.workspace;
  useEffect(() => {
    if (projects === undefined || selectedId === undefined) return;
    const project = projects.find((listed) => listed.id === selectedId);
    if (project === undefined) {
      update((current) => ({ ...current, selected: null }), true);
      return;
    }
    if (project.workspaces.some((workspace) => workspace.key === selectedKey)) return;
    update(
      (current) => ({ ...current, selected: { projectId: project.id, workspace: "main" } }),
      true,
    );
  }, [projects, selectedId, selectedKey, update]);
  const allSessions = sessions.all;
  const listedNames = useRef(new Map<string, string | null>());
  useEffect(() => {
    if (projects === undefined) return;
    const listed = new Map(
      projects.flatMap((project) =>
        project.workspaces.map((workspace) => [`${project.id}/${workspace.key}`, workspace.name]),
      ),
    );
    const gone = new Map<string, { ref: WorkspaceRef; name: string | null }>();
    for (const { workspace } of allSessions) {
      const place = `${workspace.projectId}/${workspace.workspace}`;
      if (listed.has(place)) continue;
      const projectListed = projects.some((project) => project.id === workspace.projectId);
      const name = projectListed ? (listedNames.current.get(place) ?? null) : null;
      gone.set(place, { ref: workspace, name });
    }
    listedNames.current = listed;
    if (gone.size > 0) forgetGone([...gone.values()]);
  }, [projects, allSessions, forgetGone]);
  const guideFacts = useMemo(
    () => ({
      workspaces: (projects ?? []).reduce(
        (count, project) =>
          count + project.workspaces.filter((workspace) => workspace.key !== "main").length,
        0,
      ),
      sessions: allSessions.length,
    }),
    [projects, allSessions],
  );
  const guideListed = projects !== undefined && projects.length > 0;
  const markGuideSeen = useCallback(() => {
    update((current) => ({ ...current, guideSeen: true }), true);
  }, [update]);
  const guide = useGuide({
    seen: state.guideSeen,
    listed: guideListed,
    facts: guideFacts,
    onSeen: markGuideSeen,
    notify,
  });
  const openGuide = guide.show;
  const showGuide = useCallback(() => {
    setToasts((queue) => queue.filter((queued) => queued.message !== guideClosedSentence));
    openGuide();
  }, [openGuide]);
  const sidebarShown = state.sidebar === "shown";
  const showSidebar = useCallback(() => {
    if (!sidebarShown) update((current) => ({ ...current, sidebar: "shown" }), true);
  }, [sidebarShown, update]);
  const railShape: RailShape =
    state.rail === "hidden"
      ? "hidden"
      : width < railFoldsBelow && !railUnfolded
        ? "folded"
        : "open";
  const railOpen = railShape === "open";
  const columns = fitColumns(state.columns, width, sidebarShown, railShape);
  const reachable = reachableColumns(columns, width, railShape);
  const [railView, setRailView] = useState<RailView>("changes");
  const openRail = useCallback(
    (view: RailView) => {
      setRailView(view);
      if (railShape === "folded") setRailUnfolded(true);
      if (railShape === "hidden") update((current) => ({ ...current, rail: "shown" }), true);
    },
    [railShape, update],
  );
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [checking, setChecking] = useState(false);
  const guideUnplaced = useCallback(() => {
    notify(checking ? guideWaitsForToolsSentence : guideWaitsSentence, "info");
  }, [notify, checking]);
  const closeCheck = useCallback(() => {
    setChecking(false);
  }, []);
  const select = useCallback(
    (ref: WorkspaceRef) => {
      setChecking(false);
      setProcessesOpen(false);
      update((current) => ({ ...current, selected: ref }), true);
    },
    [update],
  );
  const open = useCallback(
    (ref: WorkspaceRef | undefined) => {
      if (ref === undefined) return;
      setAdded(ref.projectId);
      select(ref);
    },
    [select],
  );
  const acceptsDrop = useCallback(
    (target: EventTarget | null) =>
      target instanceof Node &&
      [sidebarRef, centreRef].some((column) => column.current?.contains(target) === true),
    [],
  );
  const dropFolder = useCallback(
    (path: string) => {
      dismissToast();
      showSidebar();
      void drop(path).then(open);
    },
    [dismissToast, showSidebar, drop, open],
  );
  const dragging = useFolderDrop({ accepts: acceptsDrop, onFolder: dropFolder, notify });
  const selectedProject = projects?.find((project) => project.id === selectedId);
  const selectedWorkspace = selectedProject?.workspaces.find(
    (workspace) => workspace.key === state.selected?.workspace,
  );
  const removable = selectedWorkspace === undefined ? undefined : selectedProject;
  const removableAt = removable === undefined ? -1 : (projects?.indexOf(removable) ?? -1);
  const above = removableAt < 1 ? undefined : projects?.[removableAt - 1]?.id;
  const twoBelow =
    removableAt === -1 || projects?.[removableAt + 1] === undefined
      ? undefined
      : (projects[removableAt + 2]?.id ?? null);
  const newWorkspaceIn = selectedProject?.missing === null ? selectedProject.id : undefined;
  const archivable =
    selectedProject?.missing === null &&
    selectedWorkspace !== undefined &&
    selectedWorkspace.key !== "main" &&
    !selectedWorkspace.outside
      ? selectedProject
      : undefined;
  const archivableWorkspace = archivable === undefined ? undefined : selectedWorkspace;
  const hereId = selectedProject?.id;
  const hereKey = selectedWorkspace?.key;
  const sessionHere = useMemo<WorkspaceRef | undefined>(
    () =>
      hereId === undefined || hereKey === undefined
        ? undefined
        : { projectId: hereId, workspace: hereKey },
    [hereId, hereKey],
  );
  const folderHere = selectedProject?.missing === null;
  const [pickedView, setPickedView] = useState<ChangesShown>("branch");
  const [noBase, setNoBase] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [picked, setPicked] = useState<Picked | null>(null);
  const [diffInline, setDiffInline] = useState(false);
  const [diffNarrow, setDiffNarrow] = useState(true);
  const [shownText, setShownText] = useState<ShownText | null>(null);
  const { handle: diffHandle, read: diffSelection } = useDiffSelection();
  const { handle: fileHandle, read: fileSelection } = useDiffSelection();
  const [fileHost, setFileHost] = useState<HTMLDivElement | null>(null);
  const [fileFrontIn, setFileFrontIn] = useState<string | null>(null);
  const [fileShown, setFileShown] = useState<ShownFile | null>(null);
  const changesHere = folderHere && !checking ? (sessionHere ?? null) : null;
  const shownHere = changesHere !== null;
  const hereText =
    changesHere === null ? null : `${changesHere.projectId}/${changesHere.workspace}`;
  const changesView: ChangesShown =
    pickedView === "branch" && hereText !== null && noBase.get(hereText) === false
      ? "uncommitted"
      : pickedView;
  const setChangesView = useCallback(
    (view: ChangesShown) => {
      if (view === "branch" && hereText !== null) {
        setNoBase((current) =>
          current.has(hereText) ? new Map(current).set(hereText, true) : current,
        );
      }
      setPickedView(view);
    },
    [hereText],
  );
  const [pullRequestSection, setPullRequestSection] = useState<PullRequestSection>("overview");
  const changesShown = shownHere && railOpen && railView === "changes";
  const filesShown = shownHere && railOpen && railView === "files";
  const pullRequestShown = shownHere && railOpen && railView === "pull-request";
  const layoutShown =
    changesShown && !diffNarrow && shownText !== null && sideOnly(shownText.letter) === null;
  const activeSession = sessionHere === undefined ? undefined : sessions.activeOf(sessionHere);
  const tabsHere = sessionHere === undefined ? [] : sessions.tabsOf(sessionHere);
  const finishedHere = tabsHere
    .filter((tab) => tab.status === "done")
    .map((tab) => tab.key)
    .join(" ");
  const listedBranches = useMemo(
    () =>
      new Map(
        (projects ?? []).flatMap((project) =>
          project.workspaces.map((workspace) => [
            `${project.id}/${workspace.key}`,
            workspace.branch,
          ]),
        ),
      ),
    [projects],
  );
  const listedRefs = useMemo(
    () =>
      (projects ?? [])
        .filter((project) => project.missing === null)
        .flatMap((project) =>
          project.workspaces.map((workspace) => ({
            projectId: project.id,
            workspace: workspace.key,
          })),
        ),
    [projects],
  );
  const finishedElsewhere = useMemo(() => {
    const done = new Map<string, string[]>();
    for (const tab of allSessions) {
      if (tab.status !== "done") continue;
      const place = `${tab.workspace.projectId}/${tab.workspace.workspace}`;
      done.set(place, [...(done.get(place) ?? []), tab.key]);
    }
    return new Map([...done].map(([place, keys]) => [place, keys.join(" ")]));
  }, [allSessions]);
  const pullRequests = usePullRequests({
    listed: listedRefs,
    branches: listedBranches,
    shown: changesHere,
    detail: pullRequestShown,
    finished: finishedHere,
    finishedElsewhere,
  });
  const shownEntry = changesHere === null ? undefined : pullRequests.of(changesHere);
  const shownPullRequest = foundOf(shownEntry);
  const pullRequestFor = useCallback(
    (ref: WorkspaceRef) => foundOf(pullRequests.of(ref)),
    [pullRequests],
  );
  const pullRequestFilesShown = pullRequestShown && pullRequestSection === "files";
  const pullRequestBase = pullRequestFilesShown ? (shownPullRequest?.base ?? undefined) : undefined;
  const changes = useChanges(
    changesHere,
    filesShown ? "uncommitted" : pullRequestFilesShown ? "branch" : changesView,
    finishedHere,
    shownText?.path,
    pullRequestBase,
  );
  const listedReason =
    changes.list?.changes.kind === "unavailable" ? changes.list.changes.reason : undefined;
  const listedBase = changes.header?.base;
  const knownNoBase = hereText === null ? undefined : noBase.get(hereText);
  if (hereText !== null) {
    if (
      knownNoBase === undefined &&
      changesShown &&
      changesView === "branch" &&
      listedReason === "no-base"
    ) {
      setNoBase(new Map(noBase).set(hereText, false));
    } else if (knownNoBase !== undefined && listedBase !== undefined && listedBase !== null) {
      const next = new Map(noBase);
      next.delete(hereText);
      setNoBase(next);
    }
  }
  const uncommitted = useChanges(
    pullRequestFilesShown && shownPullRequest?.atHead === true ? changesHere : null,
    "uncommitted",
    finishedHere,
    undefined,
  );
  const listedWorkspace = useCallback(
    ({ projectId, workspace }: WorkspaceRef) =>
      (projects ?? []).some(
        (project) =>
          project.id === projectId && project.workspaces.some((listed) => listed.key === workspace),
      ),
    [projects],
  );
  const fileSearch = useFileSearch(changesHere, palette === "files");
  const fileTabs = useFileTabs(state, update, changesHere, listedWorkspace);
  const openFileTab = fileTabs.open;
  const activateFileTab = fileTabs.activate;
  const fileFront = hereText !== null && fileFrontIn === hereText && fileTabs.active !== null;
  const sessionMark = `${hereText ?? ""}/${activeSession ?? ""}/${String(tabsHere.length)}`;
  const [seenSessionMark, setSeenSessionMark] = useState(sessionMark);
  if (seenSessionMark !== sessionMark) {
    setSeenSessionMark(sessionMark);
    setFileFrontIn(null);
  }
  const openFile = useCallback(
    (path: string) => {
      openFileTab(path);
      setFileFrontIn(hereText);
    },
    [openFileTab, hereText],
  );
  const showSessions = useCallback(() => {
    setFileFrontIn(null);
  }, []);
  const centreFiles: CentreFiles = {
    paths: fileTabs.paths,
    active: fileTabs.active,
    front: fileFront,
    onActivate: (index) => {
      activateFileTab(index);
      setFileFrontIn(hereText);
    },
    onClose: fileTabs.close,
  };
  const openedByName = useRef<string | null>(null);
  const openFound = useCallback(
    (path: string) => {
      openedByName.current = path;
      openFile(path);
    },
    [openFile],
  );
  useEffect(() => {
    if (fileShown === null) return;
    if (openedByName.current !== fileShown.path) return;
    openedByName.current = null;
    let frame = 0;
    let tries = 60;
    const focusOpened = () => {
      const viewer = document.querySelector<HTMLElement>("[data-testid='file-pane'] textarea");
      if (viewer !== null) {
        viewer.focus();
        return;
      }
      tries -= 1;
      if (fileShown.kind === "text" && tries > 0) {
        frame = requestAnimationFrame(focusOpened);
        return;
      }
      document
        .querySelector<HTMLElement>("[data-testid^='file-tab-'][aria-selected='true']")
        ?.focus();
    };
    frame = requestAnimationFrame(focusOpened);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [fileShown]);
  const shownPullRequestUrl = shownPullRequest?.url ?? null;
  const pullRequestFound = shownPullRequest !== null;
  const placeHere =
    changesHere === null ? null : `${changesHere.projectId}/${changesHere.workspace}`;
  const thread = useThreadJump({
    place: placeHere,
    shown: pullRequestShown,
    found: shownPullRequest,
    notify,
    onSection: setPullRequestSection,
  });
  const jumpToThread = thread.jump;
  const conflicting = changes.list?.conflict?.kind === "files";
  const conflictBase = changes.list?.base ?? null;
  const activeAt = tabsHere.findIndex((tab) => tab.key === activeSession);
  const neighbour = (step: number) =>
    tabsHere.length < 2 ? undefined : tabsHere.at((activeAt + step) % tabsHere.length)?.key;
  const nextSession = neighbour(1);
  const previousSession = neighbour(-1);
  const dialogProject = projects?.find((project) => project.id === creatingIn);
  const showingProcesses = processesOpen && changesHere !== null;
  const modal =
    dialogProject !== undefined ||
    archiving !== null ||
    removing !== null ||
    asking !== null ||
    settingsOpen ||
    showingProcesses;
  const liveTerminals = allSessions
    .filter((tab) => tab.status !== "stopped")
    .map((tab) => tab.terminalId)
    .join(" ");
  const finishedTabs = allSessions
    .filter((tab) => tab.status === "done")
    .map((tab) => tab.key)
    .join(" ");
  const processes = useProcesses({ live: liveTerminals, finished: finishedTabs, notify });
  useEffect(() => {
    if (finishedTabs !== "") refresh();
  }, [finishedTabs, refresh]);
  const refreshProcesses = processes.refresh;
  useEffect(() => {
    if (processesOpen) refreshProcesses();
  }, [processesOpen, refreshProcesses]);
  const processesHere = changesHere === null ? [] : processes.rowsOf(changesHere);
  const processesFor = useCallback(
    (ref: WorkspaceRef) => processes.rowsOf(ref).length,
    [processes],
  );
  const askRemove = useCallback(
    (project: ProjectView) => {
      const parent = shownParent(project, repeatedNames(projects ?? []));
      setRemoving({
        projectId: project.id,
        name: parent === undefined ? project.name : `${project.name} in ${parent}`,
        worktrees: project.worktrees,
        ...runningHere(project, allSessions, (ref) => processes.rowsOf(ref).length),
      });
    },
    [projects, allSessions, processes],
  );
  const askArchive = useCallback((project: ProjectView, workspace: WorkspaceView) => {
    setArchiving({ project, workspace });
  }, []);
  const sessionNumber = useCallback(
    (terminalId: string) => allSessions.find((tab) => tab.terminalId === terminalId)?.number,
    [allSessions],
  );
  const askProcessPort = useCallback((url: string) => {
    setAsking({ address: url, description: portLinkSentence });
  }, []);
  const inbox = useMemo(
    () =>
      inboxRows(inboxReasons(allSessions, pullRequests.needing), ({ projectId, workspace }) =>
        (projects ?? []).some(
          (project) =>
            project.id === projectId &&
            project.workspaces.some((listed) => listed.key === workspace),
        ),
      ),
    [allSessions, pullRequests.needing, projects],
  );
  const newest = inbox[0]?.reasons[0];
  const pixelFor = useCallback(
    (projectId: string, workspace: WorkspaceKey) =>
      pullRequests.needing.some(
        (need) => need.workspace.projectId === projectId && need.workspace.workspace === workspace,
      )
        ? "needs-you"
        : sessions.pixelFor(projectId, workspace),
    [pullRequests, sessions],
  );
  const switcher = useMemo<SwitcherItem[]>(() => {
    const listed = projects ?? [];
    const repeated = repeatedNames(listed);
    return listed
      .filter((project) => project.missing === null)
      .flatMap((project) =>
        project.workspaces.map((workspace) => ({
          ref: { projectId: project.id, workspace: workspace.key },
          label: workspaceLabel(project, workspace),
          testKey: workspace.name ?? "main",
          project: project.name,
          parent: shownParent(project, repeated),
          pixel: pixelFor(project.id, workspace.key),
        })),
      );
  }, [pixelFor, projects]);
  const agents = useMemo(() => agentList(allSessions, projects ?? []), [allSessions, projects]);
  const openAgent = useCallback(
    (agent: AgentItem) => {
      select(agent.ref);
      activateSession(agent.tab);
      focusSession(agent.terminalId);
    },
    [select, activateSession],
  );
  const openFromInbox = useCallback(
    (target: InboxTarget) => {
      if (modal) return;
      select(target.workspace);
      if (target.kind === "pull-request") {
        openRail("pull-request");
        return;
      }
      activateSession(target.tab);
      focusSession(target.terminalId);
    },
    [modal, select, activateSession, openRail],
  );
  const fromNotice = useRef({ inbox, openFromInbox });
  useEffect(() => {
    fromNotice.current = { inbox, openFromInbox };
  }, [inbox, openFromInbox]);
  useEffect(
    () =>
      subscribe("notices.open", ({ workspace }) => {
        const { inbox: rows, openFromInbox: openRow } = fromNotice.current;
        const target = noticeTarget(rows, workspace);
        if (target !== undefined) openRow(target);
      }),
    [],
  );
  const closeNewWorkspace = useCallback(() => {
    setCreatingIn(null);
  }, []);
  const focusCreated = useRef(false);
  useEffect(() => {
    if (creatingIn !== null || !focusCreated.current) return;
    focusCreated.current = false;
    document
      .querySelector<HTMLElement>("[aria-label='Sidebar'] nav button[aria-current='true']")
      ?.focus();
  }, [creatingIn]);
  const created = (workspace: WorkspaceView) => {
    if (dialogProject === undefined) return;
    upsertWorkspace(dialogProject.id, workspace);
    select({ projectId: dialogProject.id, workspace: workspace.key });
    if (workspace.name !== null)
      notify(`${workspace.name} is ready in ${dialogProject.name}.`, "info");
    focusCreated.current = true;
    setCreatingIn(null);
  };
  const closeArchive = useCallback(() => {
    setArchiving(null);
  }, []);
  const focusSidebarIfLost = useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body && active.isConnected) return;
      firstVisible([
        "[aria-label='Sidebar'] nav button",
        "[aria-label='Sidebar'] button[aria-label='Add a project']",
        "[data-testid='title-sidebar']",
      ])?.focus();
    });
  }, []);
  const removeProject = useCallback(
    async (projectId: string, name: string, worktrees: string | undefined) => {
      const forgot = await remove(projectId);
      if (forgot === undefined) return;
      forgetProject(projectId);
      update(
        (current) => ({
          ...current,
          selected: current.selected?.projectId === projectId ? null : current.selected,
        }),
        true,
      );
      refresh();
      notify(forgotSentence(name, forgot, worktrees), "notice");
      focusSidebarIfLost();
    },
    [remove, forgetProject, update, refresh, notify, focusSidebarIfLost],
  );
  const closeRemoving = useCallback(() => {
    setRemoving(null);
  }, []);
  const archived = (leftover: string | null) => {
    if (archiving === null) return;
    const projectId = archiving.project.id;
    const { key, name, branch } = archiving.workspace;
    dropWorkspace(projectId, key);
    forgetWorkspace({ projectId, workspace: key });
    update(
      (current) =>
        current.selected?.projectId === projectId && current.selected.workspace === key
          ? { ...current, selected: { projectId, workspace: "main" } }
          : current,
      true,
    );
    notify(archivedSentence(String(name), branch, leftover), leftover === null ? "info" : "error");
    setArchiving(null);
    focusSidebarIfLost();
  };
  const registry = useMemo(() => {
    const theme = (choice: ThemeChoice) => () => {
      update((current) => ({ ...current, theme: choice }), true);
    };
    const notifications = (on: boolean) => () => {
      update((current) => ({ ...current, notifications: on }), true);
      notify(on ? notificationsOn : notificationsOff, "info");
    };
    return createCommandRegistry(
      guarded(
        [
          {
            id: "palette.commands",
            title: "Open the command menu",
            shortcut: { key: "k" },
            available: true,
            run: () => {
              setPalette((open) => (open === "commands" ? null : "commands"));
            },
          },
          {
            id: "project.add",
            title: "Add a project",
            shortcut: { key: "o" },
            available: true,
            run: async () => {
              dismissToast();
              showSidebar();
              open(await add());
            },
          },
          {
            id: "project.remove",
            title: "Remove this project",
            available: removable !== undefined,
            run: () => {
              if (removable !== undefined) askRemove(removable);
            },
          },
          {
            id: "project.up",
            title: "Move this project up",
            available: above !== undefined,
            run: () => {
              if (removable !== undefined && above !== undefined) move(removable.id, above);
            },
          },
          {
            id: "project.down",
            title: "Move this project down",
            available: twoBelow !== undefined,
            run: () => {
              if (removable !== undefined && twoBelow !== undefined) move(removable.id, twoBelow);
            },
          },
          {
            id: "workspace.new",
            title: "New workspace",
            shortcut: { key: "n" },
            available: newWorkspaceIn !== undefined,
            run: () => {
              if (newWorkspaceIn === undefined) return;
              setPalette(null);
              setCreatingIn(newWorkspaceIn);
            },
          },
          {
            id: "workspace.archive",
            title: "Archive this workspace",
            available: archivable !== undefined,
            run: () => {
              if (archivable === undefined || archivableWorkspace === undefined) return;
              setArchiving({ project: archivable, workspace: archivableWorkspace });
            },
          },
          {
            id: "session.new",
            title: "New Claude Code session",
            shortcut: { key: "t" },
            available: sessionHere !== undefined && folderHere,
            run: () => {
              if (sessionHere !== undefined && !openSession(sessionHere, false)) {
                notify(tabLimitSentence, "error");
              }
            },
          },
          {
            id: "session.close",
            title: "Close this session",
            available: activeSession !== undefined,
            run: () => {
              if (activeSession !== undefined) closeSession(activeSession);
            },
          },
          {
            id: "session.next",
            title: "Go to the next session",
            available: nextSession !== undefined,
            run: () => {
              if (nextSession !== undefined) activateSession(nextSession);
            },
          },
          {
            id: "session.previous",
            title: "Go to the previous session",
            available: previousSession !== undefined,
            run: () => {
              if (previousSession !== undefined) activateSession(previousSession);
            },
          },
          {
            id: "inbox.newest",
            title: "Go to the newest workspace that needs you",
            available: newest !== undefined,
            run: () => {
              if (newest !== undefined) openFromInbox(newest);
            },
          },
          {
            id: "palette.agents",
            title: "Show every agent",
            shortcut: { key: "g" },
            available: true,
            run: () => {
              setPalette((open) => (open === "agents" ? null : "agents"));
            },
          },
          {
            id: "palette.switcher",
            title: "Go to a workspace",
            shortcut: { key: "p" },
            available: true,
            run: () => {
              setPalette((open) => (open === "switcher" ? null : "switcher"));
            },
          },
          {
            id: "sidebar.toggle",
            title: sidebarShown ? "Hide the sidebar" : "Show the sidebar",
            shortcut: { key: "b" },
            available: true,
            run: () => {
              const inside = document.activeElement?.closest(`#${sidebarId}`) != null;
              update(
                (current) => ({
                  ...current,
                  sidebar: current.sidebar === "shown" ? "hidden" : "shown",
                }),
                true,
              );
              if (inside) {
                requestAnimationFrame(() => {
                  document.querySelector<HTMLElement>("[data-testid='title-sidebar']")?.focus();
                });
              }
            },
          },
          {
            id: "rail.toggle",
            title: railOpen ? "Hide the rail" : "Show the rail",
            shortcut: { key: "e" },
            available: true,
            run: () => {
              if (railShape === "folded") setRailUnfolded(true);
              else if (railShape === "hidden") {
                update((current) => ({ ...current, rail: "shown" }), true);
              } else if (width < railFoldsBelow) setRailUnfolded(false);
              else {
                const inside =
                  document.activeElement?.closest("[data-testid='column-rail']") != null;
                update((current) => ({ ...current, rail: "hidden" }), true);
                if (inside) {
                  requestAnimationFrame(() => {
                    document.querySelector<HTMLElement>("[data-testid='rail-show']")?.focus();
                  });
                }
              }
            },
          },
          {
            id: "focus.sidebar",
            title: "Focus the sidebar",
            available: true,
            run: () => {
              if (!sidebarShown) {
                flushSync(() => {
                  update((current) => ({ ...current, sidebar: "shown" }), true);
                });
              }
              focusColumn("column-sidebar", '[aria-current="true"]');
            },
          },
          {
            id: "focus.repository",
            title: "Focus the repository",
            available: true,
            run: () => {
              if (!railOpen)
                flushSync(() => {
                  openRail(railView);
                });
              focusColumn("column-rail", '[role="tab"][aria-selected="true"]');
            },
          },
          {
            id: "focus.terminal",
            title: "Focus the terminal",
            available: true,
            run: () => {
              setFileFrontIn(null);
              focusColumn("column-centre", '[data-testid="terminal"] textarea');
            },
          },
          {
            id: "settings.show",
            title: "Open settings",
            shortcut: { key: ",", ctrlAlone: true },
            available: true,
            run: () => {
              setPalette(null);
              setSettingsOpen(true);
            },
          },
          {
            id: "tools.check",
            title: "Check git, gh and Claude Code",
            available: true,
            run: () => {
              setChecking(true);
            },
          },
          {
            id: "guide.show",
            title: "Show the guide",
            available: guideListed,
            run: () => {
              showSidebar();
              showGuide();
            },
          },
          {
            id: "theme.system",
            title: "Follow the system theme",
            available: true,
            run: theme("system"),
          },
          { id: "theme.light", title: "Use the light theme", available: true, run: theme("light") },
          { id: "theme.dark", title: "Use the dark theme", available: true, run: theme("dark") },
          ...curatedThemes.map(({ id, name }) => ({
            id: `theme.${id}` as const,
            title: `Use the ${name} theme`,
            available: true,
            run: theme(id),
          })),
          {
            id: "notifications.off",
            title: "Turn notifications off",
            available: state.notifications,
            run: notifications(false),
          },
          {
            id: "notifications.on",
            title: "Turn notifications on",
            available: !state.notifications,
            run: notifications(true),
          },
          {
            id: "files.show",
            title: "Show the files",
            available: shownHere && !(railOpen && railView === "files"),
            run: () => {
              openRail("files");
            },
          },
          {
            id: "changes.show",
            title: "Show the changes",
            available: shownHere && !(railOpen && railView === "changes"),
            run: () => {
              openRail("changes");
            },
          },
          {
            id: "pull-request.show",
            title: "Show the pull request",
            available: shownHere && !(railOpen && railView === "pull-request"),
            run: () => {
              openRail("pull-request");
            },
          },
          {
            id: "processes.show",
            title: "Show running processes",
            available: shownHere,
            run: () => {
              setPalette(null);
              setProcessesOpen(true);
            },
          },
          {
            id: "pull-request.open",
            title: "Open the pull request on GitHub",
            available: shownHere && shownPullRequestUrl !== null,
            run: () => {
              if (shownPullRequestUrl !== null) askPullRequestLink(shownPullRequestUrl);
            },
          },
          {
            id: "pull-request.next-thread",
            title: "Go to the next unresolved thread",
            shortcut: { key: "j" },
            available: shownHere && pullRequestFound,
            run: () => {
              openRail("pull-request");
              setPullRequestSection("files");
              jumpToThread();
            },
          },
          {
            id: "files.open",
            title: "Open a file by name",
            shortcut: { key: "f" },
            available: shownHere,
            run: () => {
              setPalette((open) => (open === "files" ? null : "files"));
            },
          },
          {
            id: "changes.branch",
            title: "Show the branch's changes",
            available: changesShown && changesView === "uncommitted",
            run: () => {
              setChangesView("branch");
            },
          },
          {
            id: "changes.uncommitted",
            title: "Show uncommitted changes",
            available: changesShown && changesView === "branch",
            run: () => {
              setChangesView("uncommitted");
            },
          },
          {
            id: "changes.inline",
            title: "Show the diff inline",
            available: layoutShown && !diffInline,
            run: () => {
              setDiffInline(true);
            },
          },
          {
            id: "changes.update-from-base",
            title: "Ask Claude Code to update from the base branch",
            available: changesShown && conflicting,
            run: () => {
              sendToClaudeCode(conflictRequest(conflictBase));
            },
          },
          {
            id: "changes.send-lines",
            title: "Send the selected lines to Claude Code",
            shortcut: { key: "l" },
            whenFocusIn: "[data-testid='diff'], [data-testid='file-text']",
            available:
              (changesShown && shownText !== null) ||
              (fileFront && fileShown !== null && fileShown.kind !== "link"),
            run: () => {
              const inChanges = document.activeElement?.closest("[data-testid='changes']") != null;
              if (fileFront && fileShown !== null && !inChanges) {
                if (fileShown.kind !== "text") {
                  notify(notTextSentence, "error");
                  return;
                }
                const request = fileLinesRequest(fileShown.path, fileSelection());
                if (request.ok) sendToClaudeCode(request.text);
                else {
                  notify(request.sentence, "error");
                }
                return;
              }
              const selection = diffSelection();
              if (shownText === null || selection === null) {
                notify(noLinesSentence, "error");
                return;
              }
              const side = sideOnly(shownText.letter) ?? selection.side;
              const reference = lineReference({
                path: side === "original" ? (shownText.from ?? shownText.path) : shownText.path,
                side,
                view: shownText.view,
                base: shownText.base,
                start: selection.start,
                end: selection.end,
              });
              if (reference.ok) sendToClaudeCode(reference.text);
              else notify(reference.sentence, "error");
            },
          },
          {
            id: "changes.side-by-side",
            title: "Show the diff side by side",
            available: layoutShown && diffInline,
            run: () => {
              setDiffInline(false);
            },
          },
        ],
        notify,
        modal,
      ),
    );
  }, [
    modal,
    state.notifications,
    newWorkspaceIn,
    archivable,
    archivableWorkspace,
    update,
    add,
    open,
    removable,
    askRemove,
    above,
    twoBelow,
    move,
    notify,
    dismissToast,
    sessionHere,
    folderHere,
    activeSession,
    nextSession,
    previousSession,
    openSession,
    closeSession,
    activateSession,
    newest,
    openFromInbox,
    changesShown,
    fileFront,
    fileSelection,
    shownHere,
    railView,
    railOpen,
    railShape,
    openRail,
    width,
    changesView,
    setChangesView,
    layoutShown,
    diffInline,
    conflicting,
    conflictBase,
    shownText,
    fileShown,
    diffSelection,
    shownPullRequestUrl,
    pullRequestFound,
    jumpToThread,
    askPullRequestLink,
    guideListed,
    showGuide,
    sidebarShown,
    showSidebar,
  ]);
  const latestRegistry = useRef(registry);
  useEffect(() => {
    latestRegistry.current = registry;
  }, [registry]);
  useEffect(
    () =>
      subscribe("window.settings", () => {
        const command = latestRegistry.current.get("settings.show");
        if (command?.available === true) command.run();
      }),
    [],
  );
  const setColumn = (side: "sidebar" | "rail", persist: boolean) => (value: number) => {
    update((current) => ({ ...current, columns: { ...current.columns, [side]: value } }), persist);
  };
  const sessionsShown =
    !checking && sessionHere !== undefined && (folderHere || tabsHere.length > 0);
  const centre = () => {
    if (checking) return <ToolCheckCard key="revisit" firstRun={false} onClose={closeCheck} />;
    if (projects === undefined) return null;
    if (projects.length === 0) return <ToolCheckCard key="first-run" firstRun />;
    if (selectedProject === undefined || selectedWorkspace === undefined) {
      return <NothingSelected />;
    }
    return (
      <>
        <WorkspaceHeader
          project={selectedProject}
          workspace={selectedWorkspace}
          base={changes.header?.base ?? null}
          ahead={changes.header === undefined ? selectedWorkspace.ahead : changes.header.ahead}
          behind={changes.header === undefined ? selectedWorkspace.behind : changes.header.behind}
          pullRequest={shownPullRequest}
          processes={processesHere.length}
          onShowProcesses={() => {
            setProcessesOpen(true);
          }}
          onShowPullRequest={() => {
            openRail("pull-request");
          }}
          railHidden={railShape === "hidden"}
        />
        {selectedProject.missing !== null && !sessionsShown && (
          <FolderMissing
            name={visibleText(selectedProject.name)}
            parent={visibleText(selectedProject.parent)}
            missing={selectedProject.missing}
            worktrees={selectedProject.worktrees}
            workspaces={
              selectedProject.workspaces.filter(
                (workspace) => workspace.key !== "main" && !workspace.outside,
              ).length
            }
          />
        )}
      </>
    );
  };
  const railBody = () => {
    if (changesHere === null) return null;
    const place = `${changesHere.projectId}/${changesHere.workspace}`;
    return (
      <>
        {changesShown && (
          <ChangesView
            workspace={changesHere}
            view={changesView}
            onView={setChangesView}
            inline={diffInline}
            onInline={setDiffInline}
            list={changes.list}
            error={changes.error}
            diffHandle={diffHandle}
            onShown={setShownText}
            onNarrow={setDiffNarrow}
            picked={picked}
            onPick={setPicked}
          />
        )}
        {pullRequestShown && (
          <PullRequestView
            entry={shownEntry}
            section={pullRequestSection}
            onSection={setPullRequestSection}
            onLink={askPullRequestLink}
          >
            {shownPullRequest !== null && (
              <>
                {pullRequestSection === "overview" && (
                  <PullRequestOverview found={shownPullRequest} onLink={askPullRequestLink} />
                )}
                <div hidden={pullRequestSection !== "checks"}>
                  <ChecksList
                    key={place}
                    workspace={changesHere}
                    found={shownPullRequest}
                    onLink={askPullRequestLink}
                  />
                </div>
                {pullRequestSection === "conversation" && (
                  <ConversationList found={shownPullRequest} onLink={askPullRequestLink} />
                )}
                {pullRequestSection === "files" && (
                  <PullRequestFiles
                    key={place}
                    workspace={changesHere}
                    found={shownPullRequest}
                    list={changes.list}
                    uncommitted={uncommitted.list}
                    error={changes.error}
                    handle={diffHandle}
                    current={thread.target}
                    onCurrent={thread.select}
                    onLink={askPullRequestLink}
                  />
                )}
              </>
            )}
          </PullRequestView>
        )}
        {(filesShown || fileFront) && (
          <div hidden={!filesShown} className="flex min-h-0 flex-1 flex-col">
            <FilesView
              key={place}
              workspace={changesHere}
              tabs={{ ...fileTabs, open: openFile }}
              list={filesShown ? changes.list : undefined}
              finished={finishedHere}
              handle={fileHandle}
              paneHost={fileHost}
              onShown={setFileShown}
            />
          </div>
        )}
      </>
    );
  };

  return (
    <CommandsProvider registry={registry}>
      <div
        ref={windowRef}
        data-testid="app-window"
        className="relative flex h-full flex-col bg-win text-fg"
      >
        <TitleBar
          initial={frame}
          covered={modal || palette !== null}
          place={
            selectedProject === undefined || selectedWorkspace === undefined
              ? null
              : {
                  project: selectedProject.name,
                  workspace: selectedWorkspace.name,
                }
          }
          waiting={inbox.length}
          sidebarShown={sidebarShown}
          sidebarId={sidebarId}
        />
        <div
          data-testid="columns"
          className="grid min-h-0 flex-1"
          style={{
            gridTemplateColumns: [
              sidebarShown ? `${String(columns.sidebar)}px` : "",
              "minmax(0,1fr)",
              railShape === "hidden" ? "" : `${String(columns.rail)}px`,
            ].join(" "),
          }}
        >
          <GuideLayer
            step={guide.step}
            covered={modal || palette !== null}
            focusAsk={guide.focusAsk}
            onNext={guide.next}
            onDone={guide.done}
            onClose={guide.close}
            onUnplaced={guideUnplaced}
          />
          <section
            ref={sidebarRef}
            id={sidebarId}
            hidden={!sidebarShown}
            data-testid="column-sidebar"
            aria-label="Sidebar"
            className="relative flex min-h-0 flex-col bg-win"
          >
            <Sidebar
              projects={projects}
              selected={state.selected}
              onSelect={select}
              onNewWorkspace={setCreatingIn}
              onRemoveProject={askRemove}
              onArchive={askArchive}
              onMove={move}
              focusProjectId={added}
              pixelFor={pixelFor}
              pullRequestFor={pullRequestFor}
              processesFor={processesFor}
              inbox={
                projects === undefined ? null : (
                  <InboxList
                    rows={inbox}
                    projects={projects}
                    selected={state.selected}
                    onOpen={openFromInbox}
                  />
                )
              }
            />
            <ColumnDivider
              side="left"
              value={columns.sidebar}
              min={interfaceLimits.sidebar.min}
              max={reachable.sidebar}
              onChange={setColumn("sidebar", false)}
              onCommit={setColumn("sidebar", true)}
              testId="divider-sidebar"
            />
          </section>
          <main
            ref={centreRef}
            data-testid="column-centre"
            aria-label="Workspace"
            className={`my-2 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-line bg-bg ${sidebarShown ? "" : "ml-2"} ${railShape === "hidden" ? "mr-2" : ""}`}
          >
            {centre()}
            <div hidden={!sessionsShown} className="flex min-h-0 flex-1 flex-col">
              <SessionsPane
                sessions={sessions}
                selected={sessionsShown ? sessionHere : null}
                files={centreFiles}
                fileHost={setFileHost}
                onSessionsFront={showSessions}
                resumeAllowed={guide.step === null && !checking}
                onAskLink={askTerminalLink}
                notify={notify}
              />
            </div>
          </main>
          <section
            data-testid="column-rail"
            aria-label="Rail"
            hidden={railShape === "hidden"}
            className="relative flex min-h-0 flex-col bg-win"
          >
            <Rail
              view={railView}
              folded={railShape === "folded"}
              pullRequest={shownPullRequest?.number ?? null}
              onView={setRailView}
              onUnfold={openRail}
            >
              {railBody()}
            </Rail>
            {railOpen && (
              <ColumnDivider
                side="right"
                value={columns.rail}
                min={interfaceLimits.rail.min}
                max={reachable.rail}
                onChange={setColumn("rail", false)}
                onCommit={setColumn("rail", true)}
                testId="divider-rail"
              />
            )}
          </section>
        </div>
        {dragging && <DropOverlay />}
        {palette !== null && (
          <Palette
            mode={palette}
            onClose={() => {
              setPalette(null);
            }}
            switcher={switcher}
            onOpenWorkspace={select}
            agents={agents}
            onOpenAgent={openAgent}
            files={fileSearch.search}
            onOpenFile={openFound}
            onQuery={fileSearch.ask}
          />
        )}
        {dialogProject !== undefined && (
          <NewWorkspaceDialog
            key={dialogProject.id}
            project={dialogProject}
            onClose={closeNewWorkspace}
            onCreated={created}
          />
        )}
        {archiving !== null && (
          <ArchiveDialog
            key={`${archiving.project.id}-${archiving.workspace.key}`}
            project={archiving.project}
            workspace={archiving.workspace}
            onClose={closeArchive}
            onArchived={archived}
          />
        )}
        {showingProcesses && selectedProject !== undefined && selectedWorkspace !== undefined && (
          <ProcessesDialog
            key={`${changesHere.projectId}/${changesHere.workspace}`}
            label={workspaceLabel(selectedProject, selectedWorkspace)}
            rows={processesHere}
            more={processes.moreOf(changesHere)}
            sessionNumber={sessionNumber}
            stopping={processes.stopping}
            problem={processes.problem}
            onStop={processes.stop}
            onPort={askProcessPort}
            onClose={closeProcesses}
          />
        )}
        {removing !== null && (
          <RemoveProjectDialog
            key={removing.projectId}
            name={removing.name}
            sessions={removing.sessions}
            processes={removing.processes}
            onClose={closeRemoving}
            onRemove={() => {
              setRemoving(null);
              void removeProject(removing.projectId, removing.name, removing.worktrees);
            }}
          />
        )}
        {settingsOpen && (
          <SettingsDialog
            theme={state.theme}
            onTheme={(theme) => {
              update((current) => ({ ...current, theme }), true);
            }}
            notifications={state.notifications}
            onNotifications={(on) => {
              update((current) => ({ ...current, notifications: on }), true);
            }}
            guideReady={guideListed}
            onShowGuide={() => {
              setSettingsOpen(false);
              showSidebar();
              showGuide();
            }}
            onLink={askAboutLink}
            onClose={closeSettings}
          />
        )}
        {asking !== null && (
          <LinkDialog
            key={asking.address}
            address={asking.address}
            description={asking.description}
            onClose={closeLink}
            notify={notify}
          />
        )}
        <div role="status" data-stays-live="" className="absolute">
          {toast !== undefined && (
            <Toast
              key={toast.id}
              message={toast.message}
              tone={toast.tone}
              onDismiss={dismissToast}
            />
          )}
        </div>
      </div>
    </CommandsProvider>
  );
}
