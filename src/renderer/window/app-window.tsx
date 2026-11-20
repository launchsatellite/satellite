import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  interfaceLimits,
  type InterfaceState,
  type ProjectView,
  type ThemeChoice,
  type WorkspaceRef,
  type WorkspaceView,
} from "../../shared/bridge-contract.ts";
import { createCommandRegistry, type Command } from "../commands/command-registry.ts";
import { CommandsProvider } from "../commands/commands-context.tsx";
import { Palette, type SwitcherItem } from "../palette/palette.tsx";
import { DropOverlay, useFolderDrop } from "../projects/drop-overlay.tsx";
import { Sidebar } from "../projects/sidebar.tsx";
import { repeatedNames, useProjects, workspaceLabel } from "../projects/use-projects.ts";
import { WorkspaceHeader } from "../projects/workspace-header.tsx";
import { ClaudePane } from "../proving/claude-pane.tsx";
import { SampleDiff } from "../proving/sample-diff.tsx";
import { ToolCheckCard } from "../setup/tool-check.tsx";
import { Toast, type Notify, type ToastTone } from "../ui/toast.tsx";
import { ArchiveDialog } from "../workspaces/archive-dialog.tsx";
import { NewWorkspaceDialog } from "../workspaces/new-workspace-dialog.tsx";
import { ColumnDivider } from "./column-divider.tsx";
import { fitColumns, reachableColumns } from "./columns.ts";
import { FolderMissing, NothingSelected } from "./empty-states.tsx";
import { useInterfaceState } from "./interface-state.ts";

type PaletteMode = "commands" | "switcher";
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
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<{
    project: ProjectView;
    workspace: WorkspaceView;
  } | null>(null);
  const [added, setAdded] = useState<string>();
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
          ...(repeated.has(project.name) && project.parent !== ""
            ? { parent: project.parent }
            : {}),
        })),
      );
  }, [projects]);
  const selectedProject = projects?.find((project) => project.id === selectedId);
  const selectedWorkspace = selectedProject?.workspaces.find(
    (workspace) => workspace.key === state.selected?.workspace,
  );
  const removable = selectedWorkspace === undefined ? undefined : selectedProject;
  const removableId = removable?.id;
  const removableName =
    removable === undefined
      ? undefined
      : repeatedNames(projects ?? []).has(removable.name) && removable.parent !== ""
        ? `${removable.name} in ${removable.parent}`
        : removable.name;
  const newWorkspaceIn = selectedProject?.missing === null ? selectedProject.id : undefined;
  const archivable =
    selectedProject?.missing === null &&
    selectedWorkspace !== undefined &&
    selectedWorkspace.key !== "main"
      ? selectedProject
      : undefined;
  const archivableWorkspace = archivable === undefined ? undefined : selectedWorkspace;
  const dialogProject = projects?.find((project) => project.id === creatingIn);
  const modal = dialogProject !== undefined || archiving !== null;
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
        ],
        notify,
        modal,
      ),
    );
  }, [
    modal,
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
        <WorkspaceHeader project={selectedProject} workspace={selectedWorkspace} />
        {selectedProject.missing !== null ? (
          <FolderMissing
            name={selectedProject.name}
            parent={selectedProject.parent}
            missing={selectedProject.missing}
          />
        ) : (
          <div className="min-h-0 flex-1">
            <SampleDiff />
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
        <section data-testid="column-sessions" aria-label="Sessions" className="min-h-0">
          <ClaudePane
            key={
              state.selected === null
                ? "none"
                : `${state.selected.projectId}/${state.selected.workspace}`
            }
            workspace={state.selected}
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
