import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  interfaceLimits,
  type InterfaceState,
  type ThemeChoice,
  type WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { createCommandRegistry, type Command } from "../commands/command-registry.ts";
import { CommandsProvider } from "../commands/commands-context.tsx";
import { Palette, type SwitcherItem } from "../palette/palette.tsx";
import { Sidebar } from "../projects/sidebar.tsx";
import { useProjects } from "../projects/use-projects.ts";
import { WorkspaceHeader } from "../projects/workspace-header.tsx";
import { ClaudePane } from "../proving/claude-pane.tsx";
import { SampleDiff } from "../proving/sample-diff.tsx";
import { ToolCheckCard } from "../setup/tool-check.tsx";
import { Toast, type Notify, type ToastTone } from "../ui/toast.tsx";
import { ColumnDivider } from "./column-divider.tsx";
import { fitColumns } from "./columns.ts";
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
const toastQueueLimit = 3;

function guarded(specs: readonly CommandSpec[], notify: Notify): Command[] {
  const fail = (error: unknown) => {
    console.error("A command failed", error);
    notify(commandFailure, "error");
  };
  return specs.map((spec) => ({
    ...spec,
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
        const waiting = queue[0]?.tone === "error" ? queue.slice(1) : queue;
        return [shown, ...waiting].slice(0, toastQueueLimit);
      }
      return queue.length >= toastQueueLimit ? queue : [...queue, shown];
    });
  }, []);
  const dismissToast = useCallback(() => {
    setToasts((queue) => queue.slice(1));
  }, []);
  const toast = toasts[0];
  const { state, update } = useInterfaceState(initial, notify);
  const { projects, add, remove, refresh } = useProjects(notify);
  const [added, setAdded] = useState<string>();
  const windowRef = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (projects === undefined || selectedId === undefined) return;
    if (projects.some((project) => project.id === selectedId)) return;
    update((current) => ({ ...current, selected: null }), true);
  }, [projects, selectedId, update]);
  const { left, right } = fitColumns(state.columns, width);
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
  const switcher = useMemo<SwitcherItem[]>(
    () =>
      (projects ?? [])
        .filter((project) => project.missing === null)
        .flatMap((project) =>
          project.workspaces.map((workspace) => ({
            ref: { projectId: project.id, workspace: workspace.key },
            label: workspace.branch ?? "detached",
            project: project.name,
          })),
        ),
    [projects],
  );
  const selectedProject = projects?.find((project) => project.id === selectedId);
  const selectedWorkspace = selectedProject?.workspaces.find(
    (workspace) => workspace.key === state.selected?.workspace,
  );
  const removable = selectedWorkspace === undefined ? undefined : selectedProject;
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
              const ref = await add();
              if (ref === undefined) return;
              setAdded(ref.projectId);
              select(ref);
            },
          },
          {
            id: "project.remove",
            title: "Remove project",
            available: removable !== undefined,
            run: async () => {
              if (removable === undefined) return;
              if (!(await remove(removable.id))) return;
              update((current) => ({ ...current, selected: null }), true);
              refresh();
              notify(`Satellite forgot ${removable.name}. Its folder is untouched.`, "info");
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
      ),
    );
  }, [update, add, remove, refresh, removable, select, notify, dismissToast]);
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
          <FolderMissing name={selectedProject.name} missing={selectedProject.missing} />
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
        className="grid h-full bg-bg text-fg"
        style={{ gridTemplateColumns: `${String(left)}px minmax(0,1fr) ${String(right)}px` }}
      >
        <section
          data-testid="column-projects"
          aria-label="Sidebar"
          className="relative flex min-h-0 flex-col border-r border-line bg-side"
        >
          <Sidebar
            projects={projects}
            selected={state.selected}
            onSelect={select}
            focusProjectId={added}
          />
          <ColumnDivider
            side="left"
            value={left}
            min={interfaceLimits.left.min}
            max={interfaceLimits.left.max}
            onChange={setColumn("left", false)}
            onCommit={setColumn("left", true)}
            testId="divider-left"
          />
        </section>
        <section
          data-testid="column-repository"
          aria-label="Repository"
          className="relative flex min-h-0 min-w-0 flex-col border-r border-line"
        >
          {centre()}
          <ColumnDivider
            side="right"
            value={right}
            min={interfaceLimits.right.min}
            max={interfaceLimits.right.max}
            onChange={setColumn("right", false)}
            onCommit={setColumn("right", true)}
            testId="divider-right"
          />
        </section>
        <section data-testid="column-sessions" aria-label="Sessions" className="min-h-0">
          <ClaudePane />
        </section>
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
