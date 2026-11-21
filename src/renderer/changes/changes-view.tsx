import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type {
  ChangesList,
  ChangesView as View,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import type { DiffHandle } from "../diff/diff-view.tsx";
import { Segmented } from "../ui/segmented.tsx";
import { CentreTabs, centrePanelId, centreTabId } from "../window/centre-tabs.tsx";
import { ChangeList } from "./change-list.tsx";
import { emptySentence, unavailableSentence } from "./change-words.ts";
import { FileDiff, type ShownText } from "./file-diff.tsx";
import { changesPlace } from "./use-changes.ts";

interface ChangesViewProps {
  workspace: WorkspaceRef;
  view: View;
  onView: (view: View) => void;
  inline: boolean;
  onInline: (inline: boolean) => void;
  list: ChangesList | undefined;
  error: string | null;
  diffHandle: RefObject<DiffHandle | null>;
  onShown: (shown: ShownText | null) => void;
}

interface Picked {
  place: string;
  path: string;
  index: number;
}

const views = [
  { value: "branch", label: "Branch", testId: "changes-view-branch" },
  { value: "uncommitted", label: "Uncommitted", testId: "changes-view-uncommitted" },
] as const;
const layouts = [
  { value: "side-by-side", label: "Side by side", testId: "diff-side-by-side" },
  { value: "inline", label: "Inline", testId: "diff-inline" },
] as const;

function Sentence({ testId, text }: { testId: string; text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p data-testid={testId} className="max-w-[360px] text-center text-[13px] text-fg2">
        {text}
      </p>
    </div>
  );
}

function isLost(): boolean {
  const focused = document.activeElement;
  return focused === null || focused === document.body || !focused.isConnected;
}

export function ChangesView({
  workspace,
  view,
  onView,
  inline,
  onInline,
  list,
  error,
  diffHandle,
  onShown,
}: ChangesViewProps) {
  const place = changesPlace(workspace, view);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [textShown, setTextShown] = useState(false);
  const listFocused = useRef(false);
  const listHost = useRef<HTMLDivElement>(null);
  const show = useCallback(
    (shown: ShownText | null) => {
      setTextShown(shown !== null);
      onShown(shown);
    },
    [onShown],
  );
  const changes = list?.changes;
  const files = changes?.kind === "files" ? changes.files : [];
  const kept = picked?.place === place ? picked : null;
  const found = kept === null ? -1 : files.findIndex((file) => file.path === kept.path);
  const index = found !== -1 ? found : Math.min(kept?.index ?? 0, files.length - 1);
  const file = files[index];
  if (file !== undefined && (kept?.path !== file.path || kept.index !== index)) {
    setPicked({ place, path: file.path, index });
  }
  const select = (path: string) => {
    setPicked({ place, path, index: files.findIndex((listed) => listed.path === path) });
  };
  const selectedPath = file?.path;
  useEffect(() => {
    if (selectedPath === undefined || !listFocused.current || !isLost()) return;
    listHost.current?.querySelector<HTMLElement>("[aria-current='true']")?.focus();
  }, [selectedPath, list]);

  const body = () => {
    if (list === undefined || changes === undefined) {
      return error === null ? null : <Sentence testId="changes-error" text={error} />;
    }
    if (changes.kind === "unavailable") {
      return (
        <Sentence
          testId="changes-unavailable"
          text={unavailableSentence(changes.reason, list.base)}
        />
      );
    }
    if (files.length === 0 && changes.more === 0 && changes.longPaths === 0) {
      return <Sentence testId="changes-empty" text={emptySentence(view, list.base)} />;
    }
    return (
      <div className="@container flex h-full min-h-0">
        <div className="flex h-full min-h-0 w-full flex-col @min-[640px]:flex-row">
          <div
            ref={listHost}
            onFocus={() => {
              listFocused.current = true;
            }}
            onBlur={(event) => {
              if (event.relatedTarget !== null) listFocused.current = false;
            }}
            className="flex max-h-[40%] min-h-0 flex-none flex-col border-b border-line @min-[640px]:max-h-none @min-[640px]:w-[260px] @min-[640px]:border-r @min-[640px]:border-b-0"
          >
            <ChangeList
              files={files}
              more={changes.more}
              longPaths={changes.longPaths}
              selected={selectedPath}
              onSelect={select}
            />
            {error !== null && (
              <p data-testid="changes-error" className="px-3 py-2 text-[12px] text-fg2">
                {error}
              </p>
            )}
          </div>
          <div className="min-h-0 min-w-0 flex-1">
            {file !== undefined && (
              <FileDiff
                workspace={workspace}
                view={view}
                file={file}
                base={list.base}
                inline={inline}
                handle={diffHandle}
                onShown={show}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div data-testid="changes" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 flex-none items-center gap-2 border-b border-line bg-side px-2">
        <CentreTabs />
        <div className="ml-auto flex flex-none items-center gap-2">
          <Segmented label="Changes to show" value={view} options={views} onChange={onView} />
          {textShown && (
            <Segmented
              label="Diff layout"
              value={inline ? "inline" : "side-by-side"}
              options={layouts}
              onChange={(layout) => {
                onInline(layout === "inline");
              }}
            />
          )}
        </div>
      </div>
      <div
        role="tabpanel"
        id={centrePanelId}
        aria-labelledby={centreTabId}
        className="min-h-0 flex-1"
      >
        {body()}
      </div>
    </div>
  );
}
