import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectView, WorkspaceRef, WorkspaceView } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import type { Notify } from "../ui/toast.tsx";

const listStaleMs = 15_000;
const listFailure =
  "Satellite couldn't read the project list. It tries again when the window gets focus.";

export function workspaceLabel(project: ProjectView, workspace: WorkspaceView): string {
  if (project.missing !== null) return "unavailable";
  return workspace.branch ?? "detached";
}

export function useProjects(notify: Notify): {
  projects: ProjectView[] | undefined;
  add: () => Promise<WorkspaceRef | undefined>;
  remove: (projectId: string) => Promise<boolean>;
  refresh: () => void;
} {
  const [projects, setProjects] = useState<ProjectView[]>();
  const listingSince = useRef<number | undefined>(undefined);
  const latest = useRef(0);
  const changes = useRef(0);
  const removing = useRef(new Set<string>());
  const refresh = useCallback(() => {
    const since = listingSince.current;
    if (since !== undefined && Date.now() - since < listStaleMs) return;
    latest.current += 1;
    const request = latest.current;
    listingSince.current = Date.now();
    void (async () => {
      for (;;) {
        const startedAt = changes.current;
        const result = await invoke("projects.list", {});
        if (request !== latest.current) return;
        if (!result.ok) {
          notify(listFailure, "error");
          break;
        }
        if (result.value.notice !== null) notify(result.value.notice, "info");
        if (startedAt === changes.current) {
          setProjects(result.value.projects);
          break;
        }
      }
      listingSince.current = undefined;
    })();
  }, [notify]);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  const add = useCallback(async () => {
    const result = await invoke("projects.choose", {});
    if (!result.ok) {
      notify(result.error.message, "error");
      return undefined;
    }
    if (result.value.outcome === "canceled") return undefined;
    const { project } = result.value;
    changes.current += 1;
    setProjects((current) => [...(current ?? []), project]);
    const added: WorkspaceRef = { projectId: project.id, workspace: "main" };
    return added;
  }, [notify]);
  const remove = useCallback(
    async (projectId: string) => {
      if (removing.current.has(projectId)) return false;
      removing.current.add(projectId);
      const result = await invoke("projects.remove", { projectId }).finally(() => {
        removing.current.delete(projectId);
      });
      if (!result.ok) {
        notify(result.error.message, "error");
        return false;
      }
      changes.current += 1;
      setProjects((current) => current?.filter((project) => project.id !== projectId));
      return true;
    },
    [notify],
  );
  return { projects, add, remove, refresh };
}
