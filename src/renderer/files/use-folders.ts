import { useCallback, useEffect, useState } from "react";
import type { FolderListing, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { ancestors, openedWith } from "./tree-rows.ts";

const rememberedListings = 64;

function remembered(
  listings: ReadonlyMap<string, FolderListing>,
  open: readonly string[],
): Map<string, FolderListing> {
  const next = new Map(listings);
  for (const path of next.keys()) {
    if (next.size <= rememberedListings) break;
    if (!open.includes(path)) next.delete(path);
  }
  return next;
}

export function useFolders(
  workspace: WorkspaceRef,
  shown: string | undefined,
): {
  open: readonly string[];
  listings: ReadonlyMap<string, FolderListing>;
  setOpen: (path: string, open: boolean) => void;
} {
  const [open, setOpenFolders] = useState<readonly string[]>(() =>
    openedWith([""], shown === undefined ? [] : ancestors(shown)),
  );
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    if (shown !== undefined) setOpenFolders(openedWith(open, ancestors(shown)));
  }
  const [listings, setListings] = useState<ReadonlyMap<string, FolderListing>>(new Map());
  const { projectId, workspace: key } = workspace;
  const asked = open.join("\u0000");

  useEffect(() => {
    let stopped = false;
    const folders = asked.split("\u0000");
    void invoke("files.list", { workspace: { projectId, workspace: key }, folders }).then(
      (result) => {
        if (stopped) return;
        const answers: [string, FolderListing][] = result.ok
          ? result.value.folders.map(({ path, listing }) => [path, listing])
          : folders.map((path) => [path, { state: "failed" }]);
        setListings((current) => {
          const next = new Map(current);
          for (const [path, listing] of answers) {
            if (result.ok || !next.has(path)) next.set(path, listing);
          }
          return remembered(next, folders);
        });
      },
    );
    return () => {
      stopped = true;
    };
  }, [projectId, key, asked]);

  const setOpen = useCallback((path: string, opened: boolean) => {
    if (path === "") return;
    setOpenFolders((current) =>
      opened ? openedWith(current, [path]) : current.filter((folder) => folder !== path),
    );
  }, []);
  return { open, listings, setOpen };
}
