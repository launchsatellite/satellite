import { useCallback, useState } from "react";
import { ancestors, openedWith } from "./tree-rows.ts";

export function useFolders(shown: string | undefined): {
  open: readonly string[];
  setOpen: (path: string, open: boolean) => void;
  closeAll: (paths: readonly string[]) => void;
} {
  const [open, setOpenFolders] = useState<readonly string[]>(() =>
    openedWith([""], shown === undefined ? [] : ancestors(shown)),
  );
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    if (shown !== undefined) setOpenFolders(openedWith(open, ancestors(shown)));
  }
  const setOpen = useCallback((path: string, opened: boolean) => {
    if (path === "") return;
    setOpenFolders((current) =>
      opened ? openedWith(current, [path]) : current.filter((folder) => folder !== path),
    );
  }, []);
  const closeAll = useCallback((paths: readonly string[]) => {
    setOpenFolders((current) =>
      current.some((folder) => paths.includes(folder))
        ? current.filter((folder) => !paths.includes(folder))
        : current,
    );
  }, []);
  return { open, setOpen, closeAll };
}
