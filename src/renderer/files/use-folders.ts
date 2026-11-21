import { useCallback, useEffect, useState } from "react";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { closedFolders, openedFolder } from "./tree-rows.ts";
import { recallTree, rememberTree } from "./tree-memory.ts";

export function useFolders(workspace: WorkspaceRef): {
  open: readonly string[];
  setOpen: (path: string, open: boolean) => void;
  closeAll: (paths: readonly string[]) => void;
} {
  const [open, setOpenFolders] = useState<readonly string[]>(() => recallTree(workspace).open);
  const { projectId, workspace: key } = workspace;
  useEffect(() => {
    rememberTree({ projectId, workspace: key }, { open });
  }, [projectId, key, open]);
  const setOpen = useCallback((path: string, opened: boolean) => {
    if (path === "") return;
    setOpenFolders((current) =>
      opened ? openedFolder(current, path) : closedFolders(current, [path]),
    );
  }, []);
  const closeAll = useCallback((paths: readonly string[]) => {
    setOpenFolders((current) => closedFolders(current, paths));
  }, []);
  return { open, setOpen, closeAll };
}
