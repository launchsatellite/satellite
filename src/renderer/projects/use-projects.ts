import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectView, WorkspaceRef, WorkspaceView } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { createSchedule, type ScheduleAnswer } from "../ui/refresh-schedule.ts";
import type { Notify } from "../ui/toast.tsx";

const listFailure = "Satellite couldn't read the project list. It keeps trying.";

function isVisible(): boolean {
  return document.visibilityState === "visible";
}

export function workspaceLabel(project: ProjectView, workspace: WorkspaceView): string {
  if (project.missing !== null) return "unavailable";
  return workspace.branch ?? workspace.name ?? "detached";
}

export function useProjects(notify: Notify): {
  projects: ProjectView[] | undefined;
  add: () => Promise<WorkspaceRef | undefined>;
  drop: (path: string) => Promise<WorkspaceRef | undefined>;
  remove: (projectId: string) => Promise<number | undefined>;
  upsertWorkspace: (projectId: string, workspace: WorkspaceView) => void;
  dropWorkspace: (projectId: string, key: string) => void;
  refresh: () => void;
} {
  const [projects, setProjects] = useState<ProjectView[]>();
  const changes = useRef(0);
  const removing = useRef(new Set<string>());
  const refresher = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => {
    refresher.current();
  }, []);
  useEffect(() => {
    let stopped = false;
    let failing = false;
    const read = async (): Promise<ScheduleAnswer> => {
      for (;;) {
        const startedAt = changes.current;
        const result = await invoke("projects.list", {});
        if (stopped) return { files: false, key: "" };
        if (!result.ok) {
          if (!failing) notify(listFailure, "error");
          failing = true;
          return { files: false, key: "" };
        }
        failing = false;
        if (result.value.notice !== null) notify(result.value.notice, "notice");
        for (const sentence of result.value.dropped) notify(sentence, "notice");
        if (startedAt === changes.current) {
          const key = JSON.stringify(result.value.projects);
          setProjects((current) =>
            current !== undefined && JSON.stringify(current) === key
              ? current
              : result.value.projects,
          );
          return { files: true, key };
        }
      }
    };
    const schedule = createSchedule({
      visible: isVisible,
      now: () => performance.now(),
      after: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => {
          clearTimeout(timer);
        };
      },
      read,
    });
    const onVisibility = () => {
      if (isVisible()) schedule.refresh();
      else schedule.hide();
    };
    refresher.current = schedule.refresh;
    window.addEventListener("focus", schedule.refresh);
    document.addEventListener("visibilitychange", onVisibility);
    schedule.start();
    return () => {
      stopped = true;
      schedule.stop();
      refresher.current = () => undefined;
      window.removeEventListener("focus", schedule.refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [notify]);
  const added = useCallback((project: ProjectView) => {
    changes.current += 1;
    setProjects((current) => [...(current ?? []), project]);
    const ref: WorkspaceRef = { projectId: project.id, workspace: "main" };
    return ref;
  }, []);
  const add = useCallback(async () => {
    const result = await invoke("projects.choose", {});
    if (!result.ok) {
      notify(result.error.message, "error");
      return undefined;
    }
    if (result.value.outcome === "canceled") return undefined;
    return added(result.value.project);
  }, [notify, added]);
  const drop = useCallback(
    async (path: string) => {
      const result = await invoke("projects.drop", { path });
      if (!result.ok) {
        notify(result.error.message, "error");
        return undefined;
      }
      return added(result.value.project);
    },
    [notify, added],
  );
  const remove = useCallback(
    async (projectId: string) => {
      if (removing.current.has(projectId)) return undefined;
      removing.current.add(projectId);
      const result = await invoke("projects.remove", { projectId }).finally(() => {
        removing.current.delete(projectId);
      });
      if (!result.ok) {
        notify(result.error.message, "error");
        return undefined;
      }
      changes.current += 1;
      setProjects((current) => current?.filter((project) => project.id !== projectId));
      return result.value.forgotWorkspaces;
    },
    [notify],
  );
  const changeWorkspaces = useCallback(
    (projectId: string, change: (workspaces: WorkspaceView[]) => WorkspaceView[]) => {
      changes.current += 1;
      setProjects((current) =>
        current?.map((project) =>
          project.id === projectId
            ? { ...project, workspaces: change(project.workspaces) }
            : project,
        ),
      );
    },
    [],
  );
  const upsertWorkspace = useCallback(
    (projectId: string, workspace: WorkspaceView) => {
      changeWorkspaces(projectId, (workspaces) =>
        workspaces.some((listed) => listed.key === workspace.key)
          ? workspaces.map((listed) => (listed.key === workspace.key ? workspace : listed))
          : [...workspaces, workspace],
      );
    },
    [changeWorkspaces],
  );
  const dropWorkspace = useCallback(
    (projectId: string, key: string) => {
      changeWorkspaces(projectId, (workspaces) =>
        workspaces.filter((listed) => listed.key !== key),
      );
    },
    [changeWorkspaces],
  );
  return { projects, add, drop, remove, upsertWorkspace, dropWorkspace, refresh };
}
