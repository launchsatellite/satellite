import { useEffect, type KeyboardEvent } from "react";
import { visibleText } from "../../shared/visible-text.ts";
import { Icon } from "../ui/icon.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { tabLabels } from "./tab-labels.ts";

interface FileTabsProps {
  paths: readonly string[];
  active: number | null;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
}

const closeMark =
  "flex size-5 items-center justify-center rounded-[4px] group-hover/close:bg-ctl group-hover/close:text-fg group-focus-visible/close:outline-2 group-focus-visible/close:outline-offset-2 group-focus-visible/close:outline-accent";
const focusRing =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";

function focusActiveTabIfLost(): void {
  requestAnimationFrame(() => {
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body && focused.isConnected) return;
    document
      .querySelector<HTMLElement>("[data-testid='file-tabs'] [aria-selected='true']")
      ?.focus();
  });
}

export const fileTabPanelId = "file-tab-panel";

export function fileTabId(index: number): string {
  return `file-tab-${String(index)}`;
}

export function FileTabs({ paths, active, onActivate, onClose }: FileTabsProps) {
  useEffect(() => {
    if (active === null) return;
    document
      .getElementById(fileTabId(active))
      ?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  const labels = tabLabels(paths);
  const close = (index: number) => {
    onClose(index);
    focusActiveTabIfLost();
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='tab']")];
    const at = buttons.findIndex((button) => button === document.activeElement);
    if (at === -1) return;
    if (event.key === "Delete") {
      event.preventDefault();
      close(at);
      return;
    }
    const targets: Record<string, number | undefined> = {
      ArrowRight: (at + 1) % buttons.length,
      ArrowLeft: (at - 1 + buttons.length) % buttons.length,
      Home: 0,
      End: buttons.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    onActivate(target);
    buttons[target]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Open files"
      data-testid="file-tabs"
      onKeyDown={move}
      className="flex h-8 flex-none items-center gap-0.5 overflow-x-auto border-b border-line bg-side px-2 [scrollbar-width:none]"
    >
      {paths.map((path, index) => {
        const selected = index === active;
        const { name, parent } = labels[index] ?? { name: path, parent: undefined };
        const shown = visibleText(path);
        return (
          <div
            key={path}
            role="presentation"
            className={`group flex h-6 max-w-[180px] min-w-0 flex-none items-center rounded-[6px] text-[12px] ${selected ? "bg-sel text-fg" : "text-dim hover:bg-hover"}`}
          >
            <button
              type="button"
              role="tab"
              id={fileTabId(index)}
              aria-selected={selected}
              aria-controls={selected ? fileTabPanelId : undefined}
              aria-keyshortcuts="Delete"
              aria-label={shown}
              title={shown}
              tabIndex={selected ? 0 : -1}
              data-testid={`file-tab-${String(index)}`}
              data-path={path}
              onClick={() => {
                onActivate(index);
              }}
              className={`h-full min-w-0 truncate rounded-[6px] pr-1 pl-[9px] ${focusRing}`}
            >
              <span aria-hidden dir="ltr" className="[unicode-bidi:isolate]">
                <VisibleName text={name} />
                {parent !== undefined && (
                  <span className="ml-1.5 text-dim">
                    <VisibleName text={parent} />
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              aria-label={`Close ${visibleText(name)}`}
              data-testid={`file-tab-${String(index)}-close`}
              onClick={() => {
                close(index);
              }}
              className={`group/close flex size-6 flex-none items-center rounded-[4px] text-dim outline-none ${selected ? "" : "opacity-0 group-hover:opacity-100"}`}
            >
              <span className={closeMark}>
                <Icon name="close" size={12} />
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
