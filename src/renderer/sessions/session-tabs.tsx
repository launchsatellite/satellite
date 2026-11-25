import { useEffect } from "react";
import { CommandButton } from "../commands/commands-context.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { Tab, Tabs } from "../ui/tabs.tsx";
import { hooksOffNote } from "./send-to-claude-code.ts";
import { pixelLabel, pixelOf } from "./session-pixel.ts";
import type { SessionTab } from "./use-sessions.ts";

interface SessionTabsProps {
  tabs: readonly SessionTab[];
  active: string | undefined;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
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
  return (
    <div className="flex h-10 flex-none items-center gap-1 border-b border-line bg-side px-2">
      <Tabs
        label="Claude Code sessions"
        value={active ?? null}
        onChange={onActivate}
        testId="session-tabs"
        className="min-w-0 self-stretch overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map((tab) => {
          const pixel = pixelOf(tab.status);
          const name = `Session ${String(tab.number)}`;
          return (
            <Tab
              key={tab.key}
              value={tab.key}
              id={sessionTabId(tab.key)}
              panel={sessionPanelId(tab.key)}
              testId={`session-tab-${String(tab.number)}`}
              tooltip={tab.hooksOff ? hooksOffNote : undefined}
              description={tab.hooksOff ? hooksOffNote : undefined}
              close={{
                label: `Close ${name}`,
                testId: `close-session-${String(tab.number)}`,
                onClose: () => {
                  onClose(tab.key);
                },
              }}
              data-state={tab.status}
              data-hooks-off={tab.hooksOff ? "" : undefined}
            >
              <StatusPixel state={pixel} size={6} label={pixelLabel(pixel)} />
              {name}
            </Tab>
          );
        })}
      </Tabs>
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
