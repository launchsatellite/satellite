import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type {
  ChangesList,
  ChangesView as View,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import type { DiffHandle } from "../diff/read-only-editor.tsx";
import { CommandButton } from "../commands/commands-context.tsx";
import { visibleText } from "../../shared/visible-text.ts";
import { Segmented } from "../ui/segmented.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { CentreTabs, centrePanelId, centreTabId, type CentreView } from "../window/centre-tabs.tsx";
import { ChangeList } from "./change-list.tsx";
import { ConflictBanner } from "./conflict-banner.tsx";
import { emptySentence, unavailableSentence } from "./change-words.ts";
import { FileDiff, sideOnly, type ShownText } from "./file-diff.tsx";
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
  onNarrow: (narrow: boolean) => void;
  onCentre: (view: CentreView) => void;
  pullRequest: number | null;
  picked: Picked | null;
  onPick: (picked: Picked) => void;
}

export interface Picked {
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

const splitMinWidth = 700;

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
  onNarrow,
  onCentre,
  pullRequest,
  picked,
  onPick: setPicked,
}: ChangesViewProps) {
  const place = changesPlace(workspace, view);
  const [layoutShown, setLayoutShown] = useState(false);
  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(true);
  const inside = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const listHost = useRef<HTMLDivElement>(null);
  const show = useCallback(
    (shown: ShownText | null) => {
      setLayoutShown(shown !== null && sideOnly(shown.letter) === null);
      onShown(shown);
    },
    [onShown],
  );
  useLayoutEffect(() => {
    if (pane === null) return;
    const measure = () => {
      setNarrow(pane.clientWidth < splitMinWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => {
      observer.disconnect();
    };
  }, [pane]);
  useEffect(() => {
    onNarrow(narrow);
  }, [narrow, onNarrow]);
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
    if (!inside.current || !isLost()) return;
    const row = listHost.current?.querySelector<HTMLElement>("[aria-selected='true']");
    (row ?? panel.current)?.focus();
  });

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
    if (
      files.length === 0 &&
      changes.more === 0 &&
      changes.longPaths === 0 &&
      !changes.untrackedLeftOut
    ) {
      return <Sentence testId="changes-empty" text={emptySentence(view, list.base)} />;
    }
    return (
      <div className="@container flex h-full min-h-0">
        <div className="flex h-full min-h-0 w-full flex-col @min-[640px]:flex-row">
          <div
            ref={listHost}
            className="flex max-h-[40%] min-h-0 flex-none flex-col border-b border-line @min-[640px]:max-h-none @min-[640px]:w-[260px] @min-[640px]:border-r @min-[640px]:border-b-0"
          >
            <ChangeList
              files={files}
              more={changes.more}
              longPaths={changes.longPaths}
              untrackedLeftOut={changes.untrackedLeftOut}
              selected={selectedPath}
              onSelect={select}
            />
            {error !== null && (
              <p data-testid="changes-error" className="px-3 py-2 text-[12px] text-fg2">
                {error}
              </p>
            )}
          </div>
          <div ref={setPane} className="min-h-0 min-w-0 flex-1">
            {file !== undefined && (
              <FileDiff
                workspace={workspace}
                view={view}
                file={file}
                base={list.base}
                inline={inline || narrow}
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
    <div
      data-testid="changes"
      className="flex min-h-0 flex-1 flex-col"
      onFocus={() => {
        inside.current = true;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) inside.current = false;
      }}
    >
      <div className="flex min-h-10 flex-none flex-wrap items-center gap-x-2 border-b border-line bg-side px-2">
        <CentreTabs value="changes" pullRequest={pullRequest} onChange={onCentre} />
        {list?.base != null && (
          <span
            data-testid="changes-base"
            dir="ltr"
            title={`from ${visibleText(list.base)}`}
            className={`min-w-[14ch] flex-1 truncate font-mono text-[12px] text-dim [unicode-bidi:isolate] ${view === "branch" ? "" : "invisible"}`}
          >
            from <VisibleName text={list.base} />
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1 py-[5px]">
          <CommandButton
            command="changes.send-lines"
            variant="ghost"
            size="small"
            testId="diff-send-lines"
          >
            Send lines
          </CommandButton>
          <Segmented label="Changes to show" value={view} options={views} onChange={onView} />
          {layoutShown && !narrow && (
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
      {list !== undefined && <ConflictBanner base={list.base} conflict={list.conflict} />}
      <div
        ref={panel}
        role="tabpanel"
        id={centrePanelId("changes")}
        aria-labelledby={centreTabId("changes")}
        tabIndex={selectedPath === undefined ? 0 : undefined}
        className="min-h-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        {body()}
      </div>
    </div>
  );
}
