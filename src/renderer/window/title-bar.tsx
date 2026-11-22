import { useEffect, useState, type ReactNode } from "react";
import type { WindowFrame } from "../../shared/bridge-contract.ts";
import { titleBar } from "../../shared/title-bar.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { subscribe } from "../bridge/bridge-client.ts";
import { CommandButton, commandShortcut, useCommands } from "../commands/commands-context.tsx";
import { VisibleName } from "../ui/visible-name.tsx";

interface TitleBarProps {
  initial: WindowFrame;
  covered: boolean;
  place: { project: string; workspace: string } | null;
  waiting: number;
  sidebarShown: boolean;
  sidebarId: string;
}

const noDrag = "flex flex-none [app-region:no-drag]";
const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function waitingLabel(count: number): string {
  if (count === 0) return "0 workspaces need you";
  const counted = count === 1 ? "1 workspace needs you" : `${String(count)} workspaces need you`;
  return `${counted}, go to the newest`;
}

function Control({ children }: { children: ReactNode }) {
  return <span className={noDrag}>{children}</span>;
}

function PlaceTitle({ place }: { place: TitleBarProps["place"] }) {
  const switcher = useCommands().get("palette.switcher");
  if (place === null || switcher === undefined) {
    return (
      <span data-testid="title-place" className="truncate text-[13px] font-semibold text-fg2">
        Satellite
      </span>
    );
  }
  const shortcut = commandShortcut(switcher);
  const name = `${visibleText(place.project)} / ${visibleText(place.workspace)}`;
  const label = `${name}, ${switcher.title.toLowerCase()}`;
  return (
    <Control>
      <button
        type="button"
        data-testid="title-place"
        aria-label={label}
        title={shortcut === undefined ? label : `${label} ${shortcut}`}
        onClick={switcher.run}
        className={`flex h-6 max-w-full min-w-0 items-center gap-[6px] rounded-[6px] px-2 text-[13px] whitespace-nowrap hover:bg-hover ${focusRing}`}
      >
        <span className="min-w-[3ch] truncate font-semibold text-fg">
          <VisibleName text={place.project} />
        </span>
        <span aria-hidden="true" className="flex-none text-dim">
          /
        </span>
        <span dir="ltr" className="min-w-[3ch] truncate text-fg2 [unicode-bidi:isolate]">
          <VisibleName text={place.workspace} />
        </span>
      </button>
    </Control>
  );
}

function useWindowFrame(initial: WindowFrame): WindowFrame {
  const [frame, setFrame] = useState(initial);
  useEffect(() => subscribe("window.frame", setFrame), []);
  return frame;
}

export function TitleBar({
  initial,
  covered,
  place,
  waiting,
  sidebarShown,
  sidebarId,
}: TitleBarProps) {
  const { frame, fullScreen } = useWindowFrame(initial);
  const drags = frame !== "native" && !covered;
  const sidebarTitle = sidebarShown ? "Hide the sidebar" : "Show the sidebar";
  return (
    <header
      data-testid="title-bar"
      data-frame={frame}
      data-drag={drags ? "true" : "false"}
      className={`flex-none border-b border-line bg-side select-none ${drags ? "[app-region:drag]" : ""}`}
    >
      <div
        className="grid grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-2 px-2"
        style={{
          height: titleBar.height - 1,
          marginLeft: frame === "overlay" ? "env(titlebar-area-x, 0px)" : undefined,
          width: frame === "overlay" ? "env(titlebar-area-width, 100%)" : undefined,
          paddingLeft: frame === "inset" && !fullScreen ? titleBar.trafficLightRoom : undefined,
        }}
      >
        <span className="flex min-w-0 items-center">
          <Control>
            <CommandButton
              command="sidebar.toggle"
              variant="ghost"
              size="small"
              icon="sidebar"
              label={sidebarTitle}
              tooltip={sidebarTitle}
              expanded={sidebarShown}
              controls={sidebarId}
              testId="title-sidebar"
            />
          </Control>
        </span>
        <span className="flex min-w-0 justify-center">
          <PlaceTitle place={place} />
        </span>
        <span className="flex min-w-0 items-center justify-end gap-1">
          <Control>
            <CommandButton
              command="inbox.newest"
              variant="ghost"
              size="small"
              icon="bell"
              label={waitingLabel(waiting)}
              tooltip={waitingLabel(waiting)}
              testId="title-inbox"
            >
              <span
                aria-hidden="true"
                className={`font-pixel text-[12px] font-normal ${waiting > 0 ? "text-sigfg" : "text-dim"}`}
              >
                {waiting}
              </span>
            </CommandButton>
          </Control>
          <Control>
            <CommandButton
              command="palette.commands"
              variant="ghost"
              size="small"
              icon="keys"
              label="Open the command menu"
              tooltip="Open the command menu"
              testId="title-commands"
            />
          </Control>
          <Control>
            <CommandButton
              command="workspace.new"
              variant="ghost"
              size="small"
              icon="plus"
              label="New workspace"
              tooltip="New workspace"
              testId="title-new-workspace"
            />
          </Control>
        </span>
      </div>
    </header>
  );
}
