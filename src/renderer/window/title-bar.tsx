import { useEffect, useState, type ReactNode } from "react";
import type { WindowFrame } from "../../shared/bridge-contract.ts";
import { titleBar } from "../../shared/title-bar.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { invoke, subscribe } from "../bridge/bridge-client.ts";
import { CommandButton, commandShortcut, useCommands } from "../commands/commands-context.tsx";
import { Button } from "../ui/button.tsx";
import { VisibleName } from "../ui/visible-name.tsx";

interface TitleBarProps {
  initial: WindowFrame | null;
  covered: boolean;
  place: { project: string; workspace: string | null } | null;
  waiting: number;
  sidebarShown: boolean;
  sidebarId: string;
}

const noDrag = "flex flex-none [app-region:no-drag]";

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
  const name =
    place.workspace === null
      ? visibleText(place.project)
      : `${visibleText(place.project)} / ${visibleText(place.workspace)}`;
  const label = `${name}, ${switcher.title.toLowerCase()}`;
  return (
    <span className="flex min-w-0 [app-region:no-drag]">
      <Button
        variant="ghost"
        size="small"
        testId="title-place"
        label={label}
        tooltip={label}
        shortcut={shortcut}
        onClick={switcher.run}
        className="max-w-full min-w-0 gap-1.5 text-[13px] font-normal"
      >
        <span className="min-w-[3ch] truncate font-semibold text-fg">
          <VisibleName text={place.project} />
        </span>
        {place.workspace !== null && (
          <>
            <span aria-hidden="true" className="flex-none text-dim">
              /
            </span>
            <span className="min-w-[3ch] truncate text-fg2">
              <VisibleName text={place.workspace} />
            </span>
          </>
        )}
      </Button>
    </span>
  );
}

function useWindowFrame(initial: WindowFrame | null): WindowFrame | null {
  const [frame, setFrame] = useState(initial);
  useEffect(() => {
    const stop = subscribe("window.frame", setFrame);
    void invoke("window.frame", {}).then((answer) => {
      if (answer.ok) setFrame(answer.value);
    });
    return stop;
  }, []);
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
  const shown = useWindowFrame(initial);
  const frame = shown?.frame ?? "unknown";
  const drags = frame !== "native" && !covered;
  const lightsRoom =
    (frame === "inset" || frame === "unknown") && shown?.fullScreen !== true
      ? titleBar.trafficLightRoom
      : undefined;
  const sidebarTitle = sidebarShown ? "Hide the sidebar" : "Show the sidebar";
  return (
    <header
      data-testid="title-bar"
      data-frame={frame}
      data-drag={drags ? "true" : "false"}
      className={`flex-none border-b border-line bg-side select-none ${drags ? "[app-region:drag]" : ""}`}
    >
      <div
        className="grid grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center px-2"
        style={{
          height: titleBar.height - 1,
          marginLeft: "env(titlebar-area-x, 0px)",
          paddingRight:
            "max(8px, calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%) + 8px))",
          paddingLeft: lightsRoom,
        }}
      >
        <span className="flex items-center">
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
        <span className="flex min-w-0 justify-center px-6">
          <PlaceTitle place={place} />
        </span>
        <span className="flex items-center justify-end gap-1">
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
          <Control>
            <CommandButton
              command="settings.show"
              variant="ghost"
              size="small"
              icon="settings"
              label="Open settings"
              tooltip="Open settings"
              testId="title-settings"
            />
          </Control>
        </span>
      </div>
    </header>
  );
}
