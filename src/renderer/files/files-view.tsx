import { useMemo } from "react";
import type {
  ChangedFile,
  ChangesList,
  InterfaceState,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { CommandButton } from "../commands/commands-context.tsx";
import { CentreTabs, centrePanelId, centreTabId, type CentreView } from "../window/centre-tabs.tsx";
import { FilePane } from "./file-pane.tsx";
import { FileTabs } from "./file-tabs.tsx";
import { FileTree } from "./file-tree.tsx";
import { useFileTabs } from "./use-file-tabs.ts";
import { useFolders } from "./use-folders.ts";

interface FilesViewProps {
  workspace: WorkspaceRef;
  state: InterfaceState;
  update: (change: (current: InterfaceState) => InterfaceState, persist: boolean) => void;
  listed: (ref: WorkspaceRef) => boolean;
  list: ChangesList | undefined;
  onCentre: (view: CentreView) => void;
}

export function FilesView({ workspace, state, update, listed, list, onCentre }: FilesViewProps) {
  const tabs = useFileTabs(state, update, workspace, listed);
  const activePath = tabs.active === null ? undefined : tabs.paths[tabs.active];
  const { open, listings, setOpen } = useFolders(workspace, activePath);
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
            <div className="min-h-0 flex-1">
              <FilePane workspace={workspace} path={activePath} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
