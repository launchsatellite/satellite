import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  interfaceLimits,
  type ChangesView as ChangesShown,
  type InterfaceState,
  type ProjectView,
  type ThemeChoice,
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
import { InboxList } from "../inbox/inbox-list.tsx";
import { inboxReasons, inboxRows, noticeTarget, type InboxTarget } from "../inbox/inbox.ts";
import { fileLinesRequest } from "../files/file-lines.ts";
import { noFileLinesSentence, notTextSentence } from "../files/file-words.ts";
import type { ShownFile } from "../files/files-view.tsx";
import { useFileSearch } from "../files/use-file-search.ts";
import { useFileTabs } from "../files/use-file-tabs.ts";
import { Palette, type SwitcherItem } from "../palette/palette.tsx";
import { DropOverlay, useFolderDrop } from "../projects/drop-overlay.tsx";
import { Sidebar } from "../projects/sidebar.tsx";
import { repeatedNames, shownParent } from "../../shared/project-names.ts";
import { useProjects, workspaceLabel } from "../projects/use-projects.ts";
import { WorkspaceHeader } from "../projects/workspace-header.tsx";
import { focusSession } from "../sessions/focus-session.ts";
import { LinkDialog } from "../sessions/link-dialog.tsx";
import { SessionsPane } from "../sessions/sessions-pane.tsx";
import { tabLimitSentence, useSessions } from "../sessions/use-sessions.ts";
import { ToolCheckCard } from "../setup/tool-check.tsx";
import { Toast, type Notify, type ToastTone } from "../ui/toast.tsx";
import { ArchiveDialog } from "../workspaces/archive-dialog.tsx";
import { NewWorkspaceDialog } from "../workspaces/new-workspace-dialog.tsx";
import type { CentreView } from "./centre-tabs.tsx";
import { ColumnDivider } from "./column-divider.tsx";
import { fitColumns, reachableColumns } from "./columns.ts";
import { FolderMissing, NothingSelected } from "./empty-states.tsx";
import { useInterfaceState } from "./interface-state.ts";

type PaletteMode = "commands" | "switcher" | "files";
type CommandSpec = Omit<Command, "run"> & { run: () => void | Promise<void> };

interface AppWindowProps {
  initial: InterfaceState;
  notice: string | null;
}
interface ShownToast {
  id: number;
  message: string;
  tone: ToastTone;
}

const commandFailure = "Satellite couldn't finish that. Try again.";
const toastQueueLimit = 32;
const notificationsOff = "Notifications are off. The inbox still shows what needs you.";
const notificationsOn = "Notifications are on for every workspace that needs you.";

function forgotSentence(name: string, workspaces: number): string {
  if (workspaces === 0) return `Satellite forgot ${name}. Its folder is untouched.`;
  const counted = workspaces === 1 ? "1 workspace" : `${String(workspaces)} workspaces`;
  return `Satellite forgot ${name} and its ${counted}. Every folder stays where it is.`;
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

export function AppWindow({ initial, notice }: AppWindowProps) {
  const [toasts, setToasts] = useState<ShownToast[]>(() =>
    notice === null ? [] : [{ id: 1, message: notice, tone: "info" }],
  );
  const notify = useCallback<Notify>((message, tone) => {
    setToasts((queue) => {
      const shown = { id: Math.max(0, ...queue.map((queued) => queued.id)) + 1, message, tone };
      if (tone === "error") {
        const replaced = queue[0]?.tone === "error" ? queue[0] : undefined;
        if (replaced === undefined) return [shown, ...queue].slice(0, toastQueueLimit);
        return [{ ...shown, id: replaced.id }, ...queue.slice(1)];
      }
      const [head, , ...rest] = queue;
      return queue.length < toastQueueLimit || head === undefined
        ? [...queue, shown]
        : [head, ...rest, shown];
    });
  }, []);
  const dismissToast = useCallback(() => {
    setToasts((queue) => queue.slice(1));
  }, []);
  const toast = toasts[0];
  const { state, update } = useInterfaceState(initial, notify);
  const { projects, add, drop, remove, upsertWorkspace, dropWorkspace, refresh } =
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
  const [added, setAdded] = useState<string>();
  const [asking, setAsking] = useState<string | null>(null);
  const closeLink = useCallback(() => {
    setAsking(null);
  }, []);
  const windowRef = useRef<HTMLDivElement>(null);
  const projectsRef = useRef<HTMLElement>(null);
  const repositoryRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const element = windowRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
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
  const { left, right } = fitColumns(state.columns, width);
  const reachable = reachableColumns({ left, right }, width);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [checking, setChecking] = useState(false);
  const closeCheck = useCallback(() => {
    setChecking(false);
  }, []);
  const select = useCallback(
    (ref: WorkspaceRef) => {
      setChecking(false);
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
      [projectsRef, repositoryRef].some((column) => column.current?.contains(target) === true),
    [],
  );
  const dropFolder = useCallback(
    (path: string) => {
      dismissToast();
      void drop(path).then(open);
    },
    [dismissToast, drop, open],
  );
  const dragging = useFolderDrop({ accepts: acceptsDrop, onFolder: dropFolder, notify });
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
        })),
      );
  }, [projects]);
  const selectedProject = projects?.find((project) => project.id === selectedId);
  const selectedWorkspace = selectedProject?.workspaces.find(
    (workspace) => workspace.key === state.selected?.workspace,
  );
  const removable = selectedWorkspace === undefined ? undefined : selectedProject;
  const removableId = removable?.id;
  const removableParent =
    removable === undefined ? undefined : shownParent(removable, repeatedNames(projects ?? []));
  const removableName =
    removable === undefined || removableParent === undefined
      ? removable?.name
      : `${removable.name} in ${removableParent}`;
  const newWorkspaceIn = selectedProject?.missing === null ? selectedProject.id : undefined;
  const archivable =
    selectedProject?.missing === null &&
    selectedWorkspace !== undefined &&
    selectedWorkspace.key !== "main"
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
  const [centreView, setCentreView] = useState<CentreView>("changes");
  const [changesView, setChangesView] = useState<ChangesShown>("branch");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [diffInline, setDiffInline] = useState(false);
  const [diffNarrow, setDiffNarrow] = useState(true);
  const [shownText, setShownText] = useState<ShownText | null>(null);
  const { handle: diffHandle, read: diffSelection } = useDiffSelection();
  const [fileShown, setFileShown] = useState<ShownFile | null>(null);
  const changesHere = folderHere && !checking ? (sessionHere ?? null) : null;
  const shownHere = changesHere !== null;
  const changesShown = shownHere && centreView === "changes";
  const filesShown = shownHere && centreView === "files";
  const layoutShown =
    changesShown && !diffNarrow && shownText !== null && sideOnly(shownText.letter) === null;
  const activeSession = sessionHere === undefined ? undefined : sessions.activeOf(sessionHere);
  const tabsHere = sessionHere === undefined ? [] : sessions.tabsOf(sessionHere);
  const finishedHere = tabsHere
    .filter((tab) => tab.status === "done")
    .map((tab) => tab.key)
    .join(" ");
  const changes = useChanges(
    changesHere,
    filesShown ? "uncommitted" : changesView,
    finishedHere,
    shownText?.path,
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
  const openFound = useCallback(
    (path: string) => {
      openFileTab(path);
      setCentreView("files");
    },
    [openFileTab],
  );
  const conflicting = changes.list?.conflict?.kind === "files";
  const conflictBase = changes.list?.base ?? null;
  const activeAt = tabsHere.findIndex((tab) => tab.key === activeSession);
  const neighbour = (step: number) =>
    tabsHere.length < 2 ? undefined : tabsHere.at((activeAt + step) % tabsHere.length)?.key;
  const nextSession = neighbour(1);
  const previousSession = neighbour(-1);
  const dialogProject = projects?.find((project) => project.id === creatingIn);
  const modal = dialogProject !== undefined || archiving !== null || asking !== null;
  const inbox = useMemo(
    () =>
      inboxRows(inboxReasons(allSessions), ({ projectId, workspace }) =>
        (projects ?? []).some(
          (project) =>
            project.id === projectId &&
            project.workspaces.some((listed) => listed.key === workspace),
        ),
      ),
    [allSessions, projects],
  );
  const newest = inbox[0]?.reasons[0];
  const newestWorkspace = newest?.workspace;
  const newestTab = newest?.tab;
  const newestTerminal = newest?.terminalId;
  const openFromInbox = useCallback(
    ({ workspace, tab, terminalId }: InboxTarget) => {
      if (modal) return;
      select(workspace);
      activateSession(tab);
      focusSession(terminalId);
    },
    [modal, select, activateSession],
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
      const next =
        document.querySelector<HTMLElement>("[aria-label='Sidebar'] nav button") ??
        document.querySelector<HTMLElement>(
          "[aria-label='Sidebar'] button[aria-label='Add a project']",
        );
      next?.focus();
    });
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
              open(await add());
            },
          },
          {
            id: "project.remove",
            title: "Remove this project",
            available: removableId !== undefined,
            run: async () => {
              if (removableId === undefined) return;
              const forgot = await remove(removableId);
              if (forgot === undefined) return;
              forgetProject(removableId);
              update(
                (current) => ({
                  ...current,
                  selected: current.selected?.projectId === removableId ? null : current.selected,
                }),
                true,
              );
              refresh();
              notify(forgotSentence(String(removableName), forgot), "info");
              focusSidebarIfLost();
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
            available: newestTab !== undefined,
            run: () => {
              if (
                newestWorkspace === undefined ||
                newestTab === undefined ||
                newestTerminal === undefined
              ) {
                return;
              }
              openFromInbox({
                workspace: newestWorkspace,
                tab: newestTab,
                terminalId: newestTerminal,
              });
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
            id: "tools.check",
            title: "Check git, gh and Claude Code",
            available: true,
            run: () => {
              setChecking(true);
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
            available: shownHere && centreView === "changes",
            run: () => {
              setCentreView("files");
            },
          },
          {
            id: "changes.show",
            title: "Show the changes",
            available: filesShown,
            run: () => {
              setCentreView("changes");
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
              (filesShown && fileShown !== null && fileShown.kind !== "link"),
            run: () => {
              if (filesShown) {
                if (fileShown === null) return;
                if (fileShown.kind !== "text") {
                  notify(notTextSentence, "info");
                  return;
                }
                const request = fileLinesRequest(fileShown.path, diffSelection());
                if (request.ok) sendToClaudeCode(request.text);
                else {
                  notify(
                    request.sentence,
                    request.sentence === noFileLinesSentence ? "info" : "error",
                  );
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
    remove,
    refresh,
    removableId,
    removableName,
    notify,
    dismissToast,
    focusSidebarIfLost,
    sessionHere,
    folderHere,
    activeSession,
    nextSession,
    previousSession,
    openSession,
    closeSession,
    activateSession,
    forgetProject,
    newestWorkspace,
    newestTab,
    newestTerminal,
    openFromInbox,
    changesShown,
    filesShown,
    shownHere,
    centreView,
    changesView,
    layoutShown,
    diffInline,
    conflicting,
    conflictBase,
    shownText,
    fileShown,
    diffSelection,
  ]);
  const setColumn = (side: "left" | "right", persist: boolean) => (value: number) => {
    update((current) => ({ ...current, columns: { ...current.columns, [side]: value } }), persist);
  };
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
        />
        {selectedProject.missing !== null ? (
          <FolderMissing
            name={selectedProject.name}
            parent={selectedProject.parent}
            missing={selectedProject.missing}
          />
        ) : (
          changesHere !== null &&
          (centreView === "files" ? (
            <FilesView
              key={`${changesHere.projectId}/${changesHere.workspace}`}
              workspace={changesHere}
              tabs={fileTabs}
              list={changes.list}
              finished={finishedHere}
              onCentre={setCentreView}
              handle={diffHandle}
              onShown={setFileShown}
            />
          ) : (
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
              onCentre={setCentreView}
              picked={picked}
              onPick={setPicked}
            />
          ))
        )}
      </>
    );
  };

  return (
    <CommandsProvider registry={registry}>
      <div
        ref={windowRef}
        data-testid="app-window"
        className="relative grid h-full bg-bg text-fg"
        style={{ gridTemplateColumns: `${String(left)}px minmax(0,1fr) ${String(right)}px` }}
      >
        <section
          ref={projectsRef}
          data-testid="column-projects"
          aria-label="Sidebar"
          className="relative flex min-h-0 flex-col border-r border-line bg-side"
        >
          <Sidebar
            projects={projects}
            selected={state.selected}
            onSelect={select}
            onNewWorkspace={setCreatingIn}
            focusProjectId={added}
            pixelFor={sessions.pixelFor}
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
            value={left}
            min={interfaceLimits.left.min}
            max={reachable.left}
            onChange={setColumn("left", false)}
            onCommit={setColumn("left", true)}
            testId="divider-left"
          />
        </section>
        <section
          ref={repositoryRef}
          data-testid="column-repository"
          aria-label="Repository"
          className="relative flex min-h-0 min-w-0 flex-col border-r border-line"
        >
          {centre()}
          <ColumnDivider
            side="right"
            value={right}
            min={interfaceLimits.right.min}
            max={reachable.right}
            onChange={setColumn("right", false)}
            onCommit={setColumn("right", true)}
            testId="divider-right"
          />
        </section>
        <section
          data-testid="column-sessions"
          aria-label="Sessions"
          className="relative min-h-0 bg-bg"
        >
          <SessionsPane
            sessions={sessions}
            selected={sessionHere ?? null}
            onAskLink={setAsking}
            notify={notify}
          />
        </section>
        {dragging && <DropOverlay />}
        {palette !== null && (
          <Palette
            mode={palette}
            onClose={() => {
              setPalette(null);
            }}
            switcher={switcher}
            onOpenWorkspace={select}
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
        {asking !== null && (
          <LinkDialog key={asking} address={asking} onClose={closeLink} notify={notify} />
        )}
        {toast !== undefined && (
          <Toast
            key={toast.id}
            message={toast.message}
            tone={toast.tone}
            onDismiss={dismissToast}
          />
        )}
      </div>
    </CommandsProvider>
  );
}
