import { useEffect, useMemo } from "react";
import type { ChangedFile, ChangesList, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { CommandButton } from "../commands/commands-context.tsx";
import { CentreTabs, centrePanelId, centreTabId, type CentreView } from "../window/centre-tabs.tsx";
import { FilePane } from "./file-pane.tsx";
import { fileTabId, fileTabPanelId, FileTabs } from "./file-tabs.tsx";
import { FileTree } from "./file-tree.tsx";
import type { useFileTabs } from "./use-file-tabs.ts";
import { useFiles } from "./use-files.ts";
import { useFolders } from "./use-folders.ts";

interface FilesViewProps {
  workspace: WorkspaceRef;
  tabs: ReturnType<typeof useFileTabs>;
  list: ChangesList | undefined;
  finished: string;
  onCentre: (view: CentreView) => void;
}

export function FilesView({ workspace, tabs, list, finished, onCentre }: FilesViewProps) {
  const activePath = tabs.active === null ? undefined : tabs.paths[tabs.active];
  const { open, setOpen, closeAll } = useFolders(workspace);
  const { listings, file, error } = useFiles(workspace, open, activePath, finished);
  useEffect(() => {
    const gone = open.filter((path) => path !== "" && listings.get(path)?.state === "missing");
    if (gone.length > 0) closeAll(gone);
  }, [open, listings, closeAll]);
  const changes = list?.changes;
  const changed = useMemo(() => {
    const files = changes?.kind === "files" ? changes.files : [];
    return new Map<string, ChangedFile>(files.map((file) => [file.path, file]));
  }, [changes]);
  return (
    <div data-testid="files" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 flex-none flex-wrap items-center gap-x-2 border-b border-line bg-side px-2">
        <CentreTabs value="files" onChange={onCentre} />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1 py-[5px]">
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
        id={centrePanelId("files")}
        aria-labelledby={centreTabId("files")}
        className="@container min-h-0 flex-1"
      >
        <div className="flex h-full min-h-0 w-full flex-col @min-[640px]:flex-row">
          <div className="flex max-h-[40%] min-h-0 flex-none flex-col border-b border-line @min-[640px]:max-h-none @min-[640px]:w-[260px] @min-[640px]:border-r @min-[640px]:border-b-0">
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
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {tabs.paths.length > 0 && (
              <FileTabs
                paths={tabs.paths}
                active={tabs.active}
                onActivate={tabs.activate}
                onClose={tabs.close}
              />
            )}
            {error !== null && (
              <p
                data-testid="files-error"
                className="flex-none border-b border-line px-3 py-2 text-[12px] text-fg2"
              >
                {error}
              </p>
            )}
            <div
              role={tabs.active === null ? undefined : "tabpanel"}
              id={tabs.active === null ? undefined : fileTabPanelId}
              aria-labelledby={tabs.active === null ? undefined : fileTabId(tabs.active)}
              className="min-h-0 flex-1"
            >
              <FilePane file={file} path={activePath} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
