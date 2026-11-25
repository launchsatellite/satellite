import type { KeyboardEvent } from "react";
import type { ChangedFile } from "../../shared/bridge-contract.ts";
import { useListTooltip } from "../ui/tooltip.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import {
  leftOutSentence,
  letterColours,
  longPathsSentence,
  moreSentence,
  rowName,
} from "./change-words.ts";

interface ChangeListProps {
  files: readonly ChangedFile[];
  more: number;
  longPaths: number;
  untrackedLeftOut: boolean;
  selected: string | undefined;
  onSelect: (path: string) => void;
}

const focusRing =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";

function splitPath(path: string): { folder: string; name: string } {
  const slash = path.lastIndexOf("/");
  return { folder: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

function targetRow(key: string, at: number, last: number): number | undefined {
  const targets: Record<string, number | undefined> = {
    ArrowDown: Math.min(at + 1, last),
    ArrowUp: Math.max(at - 1, 0),
    Home: 0,
    End: last,
  };
  return targets[key];
}

export function ChangeList({
  files,
  more,
  longPaths,
  untrackedLeftOut,
  selected,
  onSelect,
}: ChangeListProps) {
  const tips = useListTooltip();
  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const at = rows.findIndex((row) => row === document.activeElement);
    const target = at === -1 ? undefined : targetRow(event.key, at, rows.length - 1);
    const file = target === undefined ? undefined : files[target];
    if (target === undefined || file === undefined) return;
    event.preventDefault();
    onSelect(file.path);
    rows[target]?.focus();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 [scrollbar-gutter:stable]">
      <ul
        data-testid="changes-list"
        role="listbox"
        aria-label="Changed files"
        onKeyDown={move}
        {...tips.events}
      >
        {files.map((file, index) => {
          const current = file.path === selected;
          const { folder, name } = splitPath(file.path);
          const testId = `changes-file-${String(index)}`;
          const label = rowName(file);
          return (
            <li key={file.path} role="none">
              <button
                type="button"
                data-testid={testId}
                data-tip={label}
                data-path={file.path}
                data-state={file.letter}
                role="option"
                aria-selected={current}
                aria-label={label}
                tabIndex={current || (selected === undefined && index === 0) ? 0 : -1}
                onClick={() => {
                  onSelect(file.path);
                }}
                className={`flex h-7 w-full items-center gap-2 px-3 text-left ${current ? "bg-sel" : "hover:bg-hover"} ${focusRing}`}
              >
                <span
                  aria-hidden
                  data-testid={`${testId}-letter`}
                  className={`w-[1ch] flex-none font-mono text-[12px] ${letterColours[file.letter] ?? "text-dim"}`}
                >
                  {file.letter}
                </span>
                <span
                  aria-hidden
                  dir="ltr"
                  className="flex min-w-0 flex-1 font-mono text-[12px] whitespace-nowrap [unicode-bidi:isolate]"
                >
                  <span className="min-w-0 shrink-[1000] truncate text-left text-dim [direction:rtl]">
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      <VisibleName text={folder} />
                    </span>
                  </span>
                  <span className="max-w-full min-w-[4ch] flex-none truncate text-fg">
                    <VisibleName text={name} />
                  </span>
                </span>
                <span
                  aria-hidden
                  data-testid={`${testId}-counts`}
                  className="flex flex-none gap-[6px] font-mono text-[12px]"
                >
                  {file.added !== null && file.added > 0 && (
                    <span className="text-addfg">+{file.added}</span>
                  )}
                  {file.removed !== null && file.removed > 0 && (
                    <span className="text-delfg">−{file.removed}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {tips.tip}
      {more > 0 && (
        <p data-testid="changes-more" className="px-3 pt-2 text-[12px] text-dim">
          {moreSentence(more)}
        </p>
      )}
      {longPaths > 0 && (
        <p data-testid="changes-long-paths" className="px-3 pt-2 text-[12px] text-dim">
          {longPathsSentence(longPaths)}
        </p>
      )}
      {untrackedLeftOut && (
        <p data-testid="changes-left-out" className="px-3 pt-2 text-[12px] text-dim">
          {leftOutSentence}
        </p>
      )}
    </div>
  );
}
