import { useEffect, useMemo, useRef, useState } from "react";
import {
  interfaceLimits,
  type InterfaceState,
  type ThemeChoice,
} from "../../shared/bridge-contract.ts";
import { createCommandRegistry } from "../commands/command-registry.ts";
import { commandShortcut, CommandsProvider } from "../commands/commands-context.tsx";
import { Palette, type SwitcherItem } from "../palette/palette.tsx";
import { ClaudePane } from "../proving/claude-pane.tsx";
import { SampleDiff } from "../proving/sample-diff.tsx";
import { ToolReadout } from "../proving/tool-readout.tsx";
import { Icon } from "../ui/icon.tsx";
import { KeyHint } from "../ui/key-hint.tsx";
import { ColumnDivider } from "./column-divider.tsx";
import { fitColumns } from "./columns.ts";
import { useInterfaceState } from "./interface-state.ts";

type PaletteMode = "commands" | "switcher";

interface AppWindowProps {
  initial: InterfaceState;
  notice: string | null;
}

const noWorkspaces: readonly SwitcherItem[] = [];

function openWorkspace(): void {
  return undefined;
}

export function AppWindow({ initial, notice }: AppWindowProps) {
  const { state, update } = useInterfaceState(initial);
  const windowRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const element = windowRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const { left, right } = fitColumns(state.columns, width);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const registry = useMemo(() => {
    const theme = (choice: ThemeChoice) => () => {
      update({ ...state, theme: choice }, true);
    };
    return createCommandRegistry([
      {
        id: "palette.commands",
        title: "Open the command menu",
        shortcut: { key: "k" },
        available: true,
        run: () => {
          setPalette((open) => (open === "commands" ? null : "commands"));
        },
      },
      {
        id: "palette.switcher",
        title: "Go to a workspace",
        shortcut: { key: "p" },
        available: true,
        run: () => {
          setPalette((open) => (open === "switcher" ? null : "switcher"));
        },
      },
      {
        id: "theme.system",
        title: "Follow the system theme",
        available: true,
        run: theme("system"),
      },
      { id: "theme.light", title: "Use the light theme", available: true, run: theme("light") },
      { id: "theme.dark", title: "Use the dark theme", available: true, run: theme("dark") },
    ]);
  }, [state, update]);
  const openMenu = registry.get("palette.commands");
  const setColumn = (side: "left" | "right", persist: boolean) => (value: number) => {
    update({ ...state, columns: { ...state.columns, [side]: value } }, persist);
  };

  return (
    <CommandsProvider registry={registry}>
      <div
        ref={windowRef}
        data-testid="app-window"
        className="grid h-full bg-bg text-fg"
        style={{ gridTemplateColumns: `${String(left)}px minmax(0,1fr) ${String(right)}px` }}
      >
        <section
          data-testid="column-projects"
          aria-label="Projects"
          className="relative flex flex-col border-r border-line bg-side"
        >
          <div className="p-2">
            <button
              type="button"
              data-testid="open-command-menu"
              onClick={openMenu?.run}
              className="flex h-7 w-full items-center gap-[9px] rounded-[6px] px-2 text-[13px] font-medium whitespace-nowrap text-fg2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="text-dim">
                <Icon name="keys" size={15} />
              </span>
              Commands
              {openMenu !== undefined && (
                <span className="ml-auto">
                  <KeyHint keys={commandShortcut(openMenu) ?? ""} />
                </span>
              )}
            </button>
          </div>
          <div className="mt-auto p-4">
            <ToolReadout />
          </div>
          <ColumnDivider
            side="left"
            value={left}
            min={interfaceLimits.left.min}
            max={interfaceLimits.left.max}
            onChange={setColumn("left", false)}
            onCommit={setColumn("left", true)}
            testId="divider-left"
          />
        </section>
        <section
          data-testid="column-repository"
          aria-label="Repository"
          className="relative flex min-h-0 flex-col border-r border-line"
        >
          {notice !== null && (
            <p data-testid="toast" className="px-4 py-2 text-[13px] text-dim">
              {notice}
            </p>
          )}
          <div className="min-h-0 flex-1">
            <SampleDiff />
          </div>
          <ColumnDivider
            side="right"
            value={right}
            min={interfaceLimits.right.min}
            max={interfaceLimits.right.max}
            onChange={setColumn("right", false)}
            onCommit={setColumn("right", true)}
            testId="divider-right"
          />
        </section>
        <section data-testid="column-sessions" aria-label="Sessions" className="min-h-0">
          <ClaudePane />
        </section>
        {palette !== null && (
          <Palette
            mode={palette}
            onClose={() => {
              setPalette(null);
            }}
            switcher={noWorkspaces}
            onOpenWorkspace={openWorkspace}
          />
        )}
      </div>
    </CommandsProvider>
  );
}
