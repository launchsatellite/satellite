import { useEffect, useMemo, type RefObject } from "react";
import { createPortal } from "react-dom";
import type {
  ChangedFile,
  ChangesList,
  FileRead,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { CommandButton } from "../commands/commands-context.tsx";
import { railPanelId, railTabId } from "../rail/rail.tsx";
import type { DiffHandle } from "../diff/read-only-editor.tsx";
import { FilePane } from "./file-pane.tsx";
import { FileTree } from "./file-tree.tsx";
import type { useFileTabs } from "./use-file-tabs.ts";
import { useFiles } from "./use-files.ts";
import { recallTree, rememberTree } from "./tree-memory.ts";
import { useFolders } from "./use-folders.ts";

interface FilesViewProps {
  workspace: WorkspaceRef;
  tabs: ReturnType<typeof useFileTabs>;
  list: ChangesList | undefined;
  finished: string;
  handle: RefObject<DiffHandle | null>;
  paneHost: HTMLElement | null;
  onShown: (shown: ShownFile | null) => void;
}

export interface ShownFile {
  path: string;
  kind: FileRead["kind"];
}

export function FilesView({
  workspace,
  tabs,
  list,
  finished,
  handle,
  paneHost,
  onShown,
}: FilesViewProps) {
  const activePath = tabs.active === null ? undefined : tabs.paths[tabs.active];
  const { open, setOpen, closeAll } = useFolders(workspace);
  const { listings, file, listError, fileError } = useFiles(workspace, open, activePath, finished);
  useEffect(() => {
    const gone = open.filter((path) => path !== "" && listings.get(path)?.state === "missing");
    if (gone.length > 0) closeAll(gone);
  }, [open, listings, closeAll]);
  const shownPath = file?.path;
  const shownKind = file?.read.kind;
  useEffect(() => {
    onShown(
      shownPath === undefined || shownKind === undefined
        ? null
        : { path: shownPath, kind: shownKind },
    );
    return () => {
      onShown(null);
    };
  }, [shownPath, shownKind, onShown]);
  useEffect(() => {
    if (list !== undefined) rememberTree(workspace, { changes: list });
  }, [workspace, list]);
  const changes = (list ?? recallTree(workspace).changes)?.changes;
  const changed = useMemo(() => {
    const files = changes?.kind === "files" ? changes.files : [];
    return new Map<string, ChangedFile>(files.map((file) => [file.path, file]));
  }, [changes]);
  return (
    <div data-testid="files" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 flex-none flex-wrap items-center gap-x-2 border-b border-line pr-2 pl-4">
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1 py-[5px]">
          <CommandButton
            command="changes.send-lines"
            variant="ghost"
            size="small"
            testId="file-send-lines"
          >
            Send lines
          </CommandButton>
          <CommandButton
            command="files.open"
            variant="secondary"
            size="small"
            testId="files-find"
            label="Find a file"
          >
            Find a file
          </CommandButton>
        </div>
      </div>
      <div
        role="tabpanel"
        id={railPanelId("files")}
        aria-labelledby={railTabId("files")}
        className="flex min-h-0 flex-1 flex-col"
      >
        {listError !== null && (
          <p
            data-testid="files-error"
            role="status"
            className="flex-none border-b border-line px-3 py-2 text-[12px] text-fg2"
          >
            {listError}
          </p>
        )}
        <FileTree
          workspace={workspace}
          open={open}
          listings={listings}
          changed={changed}
          selected={activePath}
          onToggle={setOpen}
          onOpenFile={tabs.open}
        />
      </div>
      {paneHost !== null &&
        createPortal(
          <>
            {fileError !== null && (
              <p
                data-testid="file-error"
                role="status"
                className="flex-none border-b border-line px-3 py-2 text-[12px] text-fg2"
              >
                {fileError}
              </p>
            )}
            <div className="min-h-0 flex-1">
              <FilePane file={file} path={activePath} handle={handle} />
            </div>
          </>,
          paneHost,
        )}
    </div>
  );
}
