import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ChangedFile, FolderListing } from "../../shared/bridge-contract.ts";
import { Icon } from "../ui/icon.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { FileIcon, useIcons, type LoadedIcons } from "./file-icon.tsx";
import { emptyWorkspaceSentence, rowLabel } from "./file-words.ts";
import {
  isFolderKind,
  matchTyped,
  parentPath,
  treeRows,
  type ItemRow,
  type TreeRow,
} from "./tree-rows.ts";

interface FileTreeProps {
  open: readonly string[];
  listings: ReadonlyMap<string, FolderListing>;
  changed: ReadonlyMap<string, ChangedFile>;
  selected: string | undefined;
  onToggle: (path: string, open: boolean) => void;
  onOpenFile: (path: string) => void;
}

const typeAheadMs = 500;
const indentPx = 12;
const focusRing =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";

function Row({
  row,
  index,
  letter,
  icons,
  selected,
  focusable,
  onActivate,
}: {
  row: ItemRow;
  index: number;
  letter: ChangedFile | undefined;
  icons: LoadedIcons | undefined;
  selected: boolean;
  focusable: boolean;
  onActivate: () => void;
}) {
  const folder = isFolderKind(row.kind);
  const label = rowLabel(row.path, row.kind, letter?.letter, letter?.tracked ?? true, row.ignored);
  const testId = `files-row-${String(index)}`;
  const nameColour = row.ignored ? "text-dim" : letter === undefined ? "text-fg" : "text-addfg";
  return (
    <div
      role="treeitem"
      data-testid={testId}
      data-path={row.path}
      data-kind={row.kind}
      data-state={letter?.letter ?? ""}
      data-ignored={row.ignored ? "true" : undefined}
      aria-level={row.level}
      aria-setsize={row.setSize}
      aria-posinset={row.position}
      aria-expanded={folder ? row.open : undefined}
      aria-selected={selected}
      aria-label={label}
      title={label}
      tabIndex={focusable ? 0 : -1}
      onClick={onActivate}
      style={{ paddingLeft: 8 + (row.level - 1) * indentPx }}
      className={`flex h-7 cursor-default items-center gap-1.5 pr-3 ${selected ? "bg-sel" : "hover:bg-hover"} ${focusRing}`}
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
          className={`w-[1ch] flex-none font-mono text-[12px] ${letter.letter === "A" ? "text-addfg" : letter.letter === "D" ? "text-delfg" : "text-dim"}`}
        >
          {letter.letter}
        </span>
      )}
    </div>
  );
}

export function FileTree({
  open,
  listings,
  changed,
  selected,
  onToggle,
  onOpenFile,
}: FileTreeProps) {
  const icons = useIcons();
  const rows = useMemo(() => treeRows(open, listings), [open, listings]);
  const items = useMemo(() => rows.filter((row) => row.type === "item"), [rows]);
  const [focused, setFocused] = useState<string>();
  const typed = useRef({ text: "", at: 0 });
  const root = listings.get("");
  const focusedAt = items.findIndex((item) => item.path === focused);
  const stop = focusedAt === -1 ? 0 : focusedAt;

  if (root?.state === "listed" && root.entries.length === 0 && root.more === 0) {
    return (
      <p data-testid="files-empty" className="p-3 text-[13px] text-fg2">
        {emptyWorkspaceSentence}
      </p>
    );
  }

  const activate = (item: ItemRow) => {
    setFocused(item.path);
    if (isFolderKind(item.kind)) onToggle(item.path, !item.open);
    else onOpenFile(item.path);
  };
  const moveTo = (target: number, tree: HTMLElement) => {
    const item = items[target];
    if (item === undefined) return;
    setFocused(item.path);
    tree.querySelectorAll<HTMLElement>("[role='treeitem']")[target]?.focus();
  };
  const press = (event: KeyboardEvent<HTMLDivElement>) => {
    const target =
      event.target instanceof Element ? event.target.closest("[role='treeitem']") : null;
    const at = items.findIndex((item) => item.path === target?.getAttribute("data-path"));
    const item = items[at];
    if (item === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
    const tree = event.currentTarget;
    const folder = isFolderKind(item.kind);
    const next = items[at + 1];
    const targets: Record<string, (() => void) | undefined> = {
      ArrowDown: () => {
        moveTo(Math.min(at + 1, items.length - 1), tree);
      },
      ArrowUp: () => {
        moveTo(Math.max(at - 1, 0), tree);
      },
      Home: () => {
        moveTo(0, tree);
      },
      End: () => {
        moveTo(items.length - 1, tree);
      },
      Enter: () => {
        activate(item);
      },
      " ": () => {
        activate(item);
      },
      ArrowRight: () => {
        if (folder && !item.open) onToggle(item.path, true);
        else if (folder && next?.level === item.level + 1) moveTo(at + 1, tree);
      },
      ArrowLeft: () => {
        if (folder && item.open) {
          onToggle(item.path, false);
          return;
        }
        const parent = items.findIndex((candidate) => candidate.path === parentPath(item.path));
        if (item.level > 1 && parent !== -1) moveTo(parent, tree);
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
    if (found !== -1) moveTo(found, tree);
  };

  const changedFor = (row: TreeRow) => (row.type === "item" ? changed.get(row.path) : undefined);
  const indexOf = new Map(items.map((item, at) => [item.path, at]));
  return (
    <div
      role="tree"
      aria-label="Files"
      data-testid="files-tree"
      onKeyDown={press}
      className="min-h-0 flex-1 overflow-y-auto py-1"
    >
      {rows.map((row) => {
        if (row.type === "note") {
          return (
            <p
              key={`note:${row.folder}`}
              role="none"
              data-testid="files-note"
              data-path={row.folder}
              style={{ paddingLeft: 8 + (row.level - 1) * indentPx + 38 }}
              className="py-1.5 pr-3 text-[12px] leading-4 text-dim"
            >
              {row.sentence}
            </p>
          );
        }
        const itemIndex = indexOf.get(row.path) ?? 0;
        return (
          <Row
            key={row.path}
            row={row}
            index={itemIndex}
            letter={changedFor(row)}
            icons={icons}
            selected={row.path === selected}
            focusable={itemIndex === stop}
            onActivate={() => {
              activate(row);
            }}
          />
        );
      })}
    </div>
  );
}
