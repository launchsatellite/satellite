import { useEffect, type KeyboardEvent } from "react";
import { CommandButton } from "../commands/commands-context.tsx";
import { Icon } from "../ui/icon.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { pixelLabel, pixelOf } from "./session-pixel.ts";
import type { SessionTab } from "./use-sessions.ts";

interface SessionTabsProps {
  tabs: readonly SessionTab[];
  active: string | undefined;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function focusActiveTabIfLost(): void {
  requestAnimationFrame(() => {
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body && focused.isConnected) return;
    document
      .querySelector<HTMLElement>("[data-testid='session-tabs'] [aria-selected='true']")
      ?.focus();
  });
}

export function sessionTabId(key: string): string {
  return `session-tab-${key}`;
}

export function sessionPanelId(key: string): string {
  return `session-panel-${key}`;
}

export function SessionTabs({ tabs, active, onActivate, onClose }: SessionTabsProps) {
  useEffect(() => {
    if (active === undefined) return;
    document
      .getElementById(sessionTabId(active))
      ?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  const close = (key: string) => {
    onClose(key);
    focusActiveTabIfLost();
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='tab']")];
    const at = buttons.findIndex((button) => button === document.activeElement);
    const focused = tabs[at];
    if (at === -1 || focused === undefined) return;
    if (event.key === "Delete") {
      event.preventDefault();
      close(focused.key);
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
    buttons[target]?.focus();
  };
  return (
    <div className="flex h-10 flex-none items-center gap-1 border-b border-line bg-side px-2">
      <div
        role="tablist"
        aria-label="Claude Code sessions"
        data-testid="session-tabs"
        onKeyDown={move}
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map((tab) => {
          const selected = tab.key === active;
          const pixel = pixelOf(tab.status);
          const name = `Session ${String(tab.number)}`;
          return (
            <div
              key={tab.key}
              role="presentation"
              className={`group flex h-[26px] flex-none items-center rounded-[6px] text-[12px] font-medium whitespace-nowrap ${selected ? "bg-sel text-fg" : "text-dim hover:bg-hover"}`}
            >
              <button
                type="button"
                role="tab"
                id={sessionTabId(tab.key)}
                aria-selected={selected}
                aria-controls={sessionPanelId(tab.key)}
                aria-keyshortcuts="Delete"
                tabIndex={selected ? 0 : -1}
                data-testid={`session-tab-${String(tab.number)}`}
                data-state={tab.status}
                onClick={() => {
                  onActivate(tab.key);
                }}
                className={`flex h-full items-center gap-[6px] rounded-[6px] pr-1 pl-[9px] ${focusRing}`}
              >
                <StatusPixel state={pixel} size={6} label={pixelLabel(pixel)} />
                {name}
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                aria-label={`Close ${name}`}
                data-testid={`close-session-${String(tab.number)}`}
                onClick={() => {
                  close(tab.key);
                }}
                className={`mr-1 flex size-5 items-center justify-center rounded-[4px] text-dim hover:bg-hover hover:text-fg ${selected ? "" : "opacity-0 group-hover:opacity-100"} ${focusRing}`}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <CommandButton
        command="session.new"
        variant="ghost"
        size="small"
        icon="plus"
        label="New session"
        testId="new-session"
      />
    </div>
  );
}
