import { useCallback } from "react";
import {
  filesLimits,
  type FileTabs,
  type InterfaceState,
  type WorkspaceRef,
} from "../../shared/bridge-contract.ts";

type OpenTabs = Pick<FileTabs, "paths" | "active">;
type Update = (change: (current: InterfaceState) => InterfaceState, persist: boolean) => void;

export function tabsAfterOpen(entry: OpenTabs | undefined, path: string): OpenTabs {
  const paths = entry?.paths ?? [];
  const at = paths.indexOf(path);
  if (at !== -1) return { paths, active: at };
  const kept = paths.length >= filesLimits.tabsPerWorkspace ? paths.slice(1) : paths;
  return { paths: [...kept, path], active: kept.length };
}

export function tabsAfterClose(entry: OpenTabs, index: number): OpenTabs | null {
  const paths = entry.paths.filter((_, at) => at !== index);
  if (paths.length === 0) return null;
  if (index < entry.active) return { paths, active: entry.active - 1 };
  return { paths, active: Math.min(entry.active, paths.length - 1) };
}

export function pruneTabs(
  files: readonly FileTabs[],
  listed: (ref: WorkspaceRef) => boolean,
): FileTabs[] {
  return files
    .filter(({ projectId, workspace }) => listed({ projectId, workspace }))
    .slice(0, filesLimits.tabbedWorkspaces);
}

export function useFileTabs(
  state: InterfaceState,
  update: Update,
  workspace: WorkspaceRef | null,
  listed: (ref: WorkspaceRef) => boolean,
): {
  paths: string[];
  active: number | null;
  open: (path: string) => void;
  activate: (index: number) => void;
  close: (index: number) => void;
} {
  const projectId = workspace?.projectId;
  const key = workspace?.workspace;
  const entry = state.files.find((tabs) => tabs.projectId === projectId && tabs.workspace === key);
  const commit = useCallback(
    (edit: (tabs: OpenTabs | undefined) => OpenTabs | null) => {
      if (projectId === undefined || key === undefined) return;
      update((current) => {
        const found = current.files.find(
          (tabs) => tabs.projectId === projectId && tabs.workspace === key,
        );
        const next = edit(found);
        const others = current.files.filter((tabs) => tabs !== found);
        const files = next === null ? others : [{ projectId, workspace: key, ...next }, ...others];
        return { ...current, files: pruneTabs(files, listed) };
      }, true);
    },
    [projectId, key, update, listed],
  );
  const open = useCallback(
    (path: string) => {
      commit((tabs) => tabsAfterOpen(tabs, path));
    },
    [commit],
  );
  const activate = useCallback(
    (index: number) => {
      commit((tabs) => (tabs === undefined ? null : { ...tabs, active: index }));
    },
    [commit],
  );
  const close = useCallback(
    (index: number) => {
      commit((tabs) => (tabs === undefined ? null : tabsAfterClose(tabs, index)));
    },
    [commit],
  );
  return { paths: entry?.paths ?? [], active: entry?.active ?? null, open, activate, close };
}
