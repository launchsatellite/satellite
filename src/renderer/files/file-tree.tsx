import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ChangedFile, FolderListing, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { letterColours } from "../changes/change-words.ts";
import { Icon } from "../ui/icon.tsx";
import { useListTooltip } from "../ui/tooltip.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { FileIcon, useIcons, type LoadedIcons } from "./file-icon.tsx";
import { emptyWorkspaceSentence, rowLabel } from "./file-words.ts";
import { recallTree, rememberTree } from "./tree-memory.ts";
import {
  isFolderKind,
  matchTyped,
  nearestRow,
  parentPath,
  treeRows,
  type ItemRow,
} from "./tree-rows.ts";

interface FileTreeProps {
  workspace: WorkspaceRef;
  open: readonly string[];
  listings: ReadonlyMap<string, FolderListing>;
  changed: ReadonlyMap<string, ChangedFile>;
  selected: string | undefined;
  onToggle: (path: string, open: boolean) => void;
  onOpenFile: (path: string) => void;
}

const typeAheadMs = 500;
const indentPx = 12;
const rowFocusRing =
  "[[role=treeitem]:focus-visible>&]:outline-2 [[role=treeitem]:focus-visible>&]:-outline-offset-2 [[role=treeitem]:focus-visible>&]:outline-accent";

function Row({
  row,
  index,
  letter,
  icons,
  selected,
  label,
  onActivate,
}: {
  row: ItemRow;
  index: number;
  letter: ChangedFile | undefined;
  icons: LoadedIcons | undefined;
  selected: boolean;
  label: string;
  onActivate: () => void;
}) {
  const folder = isFolderKind(row.kind);
  const testId = `files-row-${String(index)}`;
  const tint = letter === undefined ? undefined : letterColours[letter.letter];
  const nameColour = row.ignored ? "text-dim" : (tint ?? "text-fg");
  return (
    <div
      data-testid={testId}
      data-tip={label}
      data-path={row.path}
      data-kind={row.kind}
      data-state={letter?.letter ?? ""}
      data-ignored={row.ignored ? "true" : undefined}
      onClick={onActivate}
      style={{ paddingLeft: 8 + (row.level - 1) * indentPx }}
      className={`flex h-7 items-center gap-1.5 pr-3 ${selected ? "bg-sel" : "hover:bg-hover"} ${rowFocusRing}`}
    >
      <span aria-hidden className="flex size-4 flex-none text-dim">
        {folder && <Icon name={row.open ? "chevron-down" : "chevron-right"} size={16} />}
      </span>
      <span className={`flex-none ${row.ignored ? "opacity-50" : ""}`}>
        <FileIcon icons={icons} name={row.name} folder={folder} open={row.open} />
      </span>
      <span
        aria-hidden
        dir="ltr"
        className={`min-w-0 flex-1 truncate font-mono text-[12px] [unicode-bidi:isolate] ${nameColour}`}
      >
        <VisibleName text={row.name} />
      </span>
      {letter !== undefined && !row.ignored && (
        <span
          aria-hidden
          data-testid={`${testId}-letter`}
          className={`w-[1ch] flex-none font-mono text-[12px] ${letterColours[letter.letter] ?? "text-dim"}`}
        >
          {letter.letter}
        </span>
      )}
    </div>
  );
}

function Note({ folder, level, sentence }: { folder: string; level: number; sentence: string }) {
  return (
    <p
      data-testid="files-note"
      data-path={folder}
      style={{ paddingLeft: 8 + (level - 1) * indentPx + 38 }}
      className="py-1.5 pr-3 text-[12px] leading-4 text-dim"
    >
      {sentence}
    </p>
  );
}

export function FileTree({
  workspace,
  open,
  listings,
  changed,
  selected,
  onToggle,
  onOpenFile,
}: FileTreeProps) {
  const icons = useIcons();
  const tips = useListTooltip();
  const rows = useMemo(() => treeRows(open, listings), [open, listings]);
  const items = useMemo(() => rows.filter((row) => row.type === "item"), [rows]);
  const paths = useMemo(() => items.map((item) => item.path), [items]);
  const [focused, setFocused] = useState<string>();
  const [seen, setSeen] = useState(paths);
  if (seen !== paths) {
    setSeen(paths);
    if (focused !== undefined && !paths.includes(focused)) {
      setFocused(nearestRow(seen, paths, focused));
    }
  }
  const typed = useRef({ text: "", at: 0 });
  const tree = useRef<HTMLDivElement>(null);
  const holding = useRef(false);
  const root = listings.get("");
  const stop = Math.max(0, paths.indexOf(focused ?? ""));
  const { projectId, workspace: key } = workspace;

  useLayoutEffect(() => {
    const element = tree.current;
    if (element === null) return;
    element.scrollTop = recallTree({ projectId, workspace: key }).scroll;
    return () => {
      rememberTree({ projectId, workspace: key }, { scroll: element.scrollTop });
    };
  }, [projectId, key]);

  useLayoutEffect(() => {
    const element = tree.current;
    if (!holding.current || element === null || element.contains(document.activeElement)) return;
    const target = [...element.querySelectorAll<HTMLElement>("[role='treeitem']")][stop];
    target?.focus({ preventScroll: true });
  }, [paths, stop]);

  if (root?.state === "listed" && root.entries.length === 0 && root.more === 0) {
    return (
      <p data-testid="files-empty" className="p-3 text-[13px] text-fg2">
        {emptyWorkspaceSentence}
      </p>
    );
  }

  const leave = (event: FocusEvent<HTMLDivElement>) => {
    const moved = event.relatedTarget;
    if (moved instanceof Node && event.currentTarget.contains(moved)) return;
    if (event.target instanceof Node && !event.target.isConnected) return;
    holding.current = false;
  };
  const activate = (item: ItemRow) => {
    setFocused(item.path);
    if (isFolderKind(item.kind)) onToggle(item.path, !item.open);
    else onOpenFile(item.path);
  };
  const moveTo = (target: number, element: HTMLElement) => {
    const item = items[target];
    if (item === undefined) return;
    setFocused(item.path);
    element.querySelectorAll<HTMLElement>("[role='treeitem']")[target]?.focus();
  };
  const press = (event: KeyboardEvent<HTMLDivElement>) => {
    const target =
      event.target instanceof Element ? event.target.closest("[role='treeitem']") : null;
    const at = Array.from(event.currentTarget.querySelectorAll("[role='treeitem']")).indexOf(
      target ?? event.currentTarget,
    );
    const item = items[at];
    if (item === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
    const element = event.currentTarget;
    const folder = isFolderKind(item.kind);
    const next = items[at + 1];
    const targets: Record<string, (() => void) | undefined> = {
      ArrowDown: () => {
        moveTo(Math.min(at + 1, items.length - 1), element);
      },
      ArrowUp: () => {
        moveTo(Math.max(at - 1, 0), element);
      },
      Home: () => {
        moveTo(0, element);
      },
      End: () => {
        moveTo(items.length - 1, element);
      },
      Enter: () => {
        activate(item);
      },
      " ": () => {
        activate(item);
      },
      ArrowRight: () => {
        if (folder && !item.open) onToggle(item.path, true);
        else if (folder && next?.level === item.level + 1) moveTo(at + 1, element);
      },
      ArrowLeft: () => {
        if (folder && item.open) {
          onToggle(item.path, false);
          return;
        }
        const parent = items.findIndex((candidate) => candidate.path === parentPath(item.path));
        if (item.level > 1 && parent !== -1) moveTo(parent, element);
      },
    };
    const run = targets[event.key];
    if (run !== undefined) {
      event.preventDefault();
      run();
      return;
    }
    if (event.key.length !== 1) return;
    const now = performance.now();
    const text = now - typed.current.at > typeAheadMs ? event.key : typed.current.text + event.key;
    typed.current = { text, at: now };
    const found = matchTyped(items, at, text);
    if (found !== -1) moveTo(found, element);
  };

  const byPath = new Map(items.map((item) => [item.path, item]));
  const indexOf = new Map(items.map((item, at) => [item.path, at]));
  const rootNotes: ReactNode[] = [];
  const branch = (folder: string, level: number): ReactNode[] => {
    const listing = listings.get(folder);
    const nodes: ReactNode[] = [];
    const note = (sentence: string, key: string) => {
      const node = <Note key={key} folder={folder} level={level} sentence={sentence} />;
      (folder === "" ? rootNotes : nodes).push(node);
    };
    if (listing?.state !== "listed" || (listing.entries.length === 0 && listing.more === 0)) {
      for (const row of rows) {
        if (row.type === "note" && row.folder === folder) note(row.sentence, `note:${folder}`);
      }
      return nodes;
    }
    for (const entry of listing.entries) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      const row = byPath.get(path);
      if (row === undefined) continue;
      const letter = changed.get(path);
      const label = rowLabel(path, row.kind, letter?.letter, letter?.tracked ?? true, row.ignored);
      const index = indexOf.get(path) ?? 0;
      nodes.push(
        <div
          key={path}
          role="treeitem"
          aria-label={label}
          aria-level={row.level}
          aria-setsize={row.setSize}
          aria-posinset={row.position}
          aria-expanded={isFolderKind(row.kind) ? row.open : undefined}
          aria-selected={path === selected}
          tabIndex={index === stop ? 0 : -1}
          onFocus={() => {
            holding.current = true;
          }}
          className="outline-none"
        >
          <Row
            row={row}
            index={index}
            letter={letter}
            icons={icons}
            selected={path === selected}
            label={label}
            onActivate={() => {
              activate(row);
            }}
          />
          {row.open && <div role="group">{branch(path, level + 1)}</div>}
        </div>,
      );
    }
    if (listing.more > 0) {
      for (const row of rows) {
        if (row.type === "note" && row.folder === folder && row.sentence.includes("not listed")) {
          note(row.sentence, `more:${folder}`);
        }
      }
    }
    return nodes;
  };
  const top = branch("", 1);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={tree} className="min-h-0 flex-1 overflow-y-auto py-1">
        <div
          role="tree"
          aria-label="Files"
          data-testid="files-tree"
          {...tips.events}
          onKeyDown={press}
          onBlur={(event) => {
            tips.events.onBlur();
            leave(event);
          }}
        >
          {top}
        </div>
        {rootNotes}
      </div>
      {tips.tip}
    </div>
  );
}
