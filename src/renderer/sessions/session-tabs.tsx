import { useEffect } from "react";
import { CommandButton } from "../commands/commands-context.tsx";
import { FileTabs, fileTabValue } from "../files/file-tabs.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { Tab, Tabs } from "../ui/tabs.tsx";
import { hooksOffNote } from "./send-to-claude-code.ts";
import { pixelLabel, pixelOf } from "./session-pixel.ts";
import type { SessionTab } from "./use-sessions.ts";

export interface CentreFiles {
  paths: readonly string[];
  active: number | null;
  front: boolean;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
}

interface SessionTabsProps {
  tabs: readonly SessionTab[];
  active: string | undefined;
  files: CentreFiles;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}

const startValue = "start";

export function sessionTabId(key: string): string {
  return `session-tab-${key}`;
}

export function sessionPanelId(key: string): string {
  return `session-panel-${key}`;
}

export function SessionTabs({ tabs, active, files, onActivate, onClose }: SessionTabsProps) {
  const frontPath = files.front && files.active !== null ? files.paths[files.active] : undefined;
  const value =
    frontPath === undefined
      ? (active ?? (tabs.length === 0 ? startValue : null))
      : fileTabValue(frontPath);
  useEffect(() => {
    document
      .querySelector("[data-testid='session-tabs'] [role='tab'][aria-selected='true']")
      ?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  return (
    <div className="flex h-9 flex-none items-center gap-1 border-b border-line px-2">
      <Tabs
        label="Claude Code sessions and open files"
        value={value}
        onChange={(next) => {
          const index = files.paths.findIndex((path) => fileTabValue(path) === next);
          if (index !== -1) files.onActivate(index);
          else onActivate(next);
        }}
        testId="session-tabs"
        className="min-w-0 self-stretch overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.length === 0 && (
          <Tab value={startValue} id="session-tab-start" testId="session-tab-start">
            Claude Code
          </Tab>
        )}
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
        <FileTabs paths={files.paths} active={files.active} onClose={files.onClose} />
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
