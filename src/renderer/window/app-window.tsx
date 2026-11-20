import { useEffect, useRef, useState } from "react";
import { interfaceLimits, type InterfaceState } from "../../shared/bridge-contract.ts";
import { ClaudePane } from "../proving/claude-pane.tsx";
import { SampleDiff } from "../proving/sample-diff.tsx";
import { ToolReadout } from "../proving/tool-readout.tsx";
import { ColumnDivider } from "./column-divider.tsx";
import { fitColumns } from "./columns.ts";
import { useInterfaceState } from "./interface-state.ts";

interface AppWindowProps {
  initial: InterfaceState;
  notice: string | null;
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
  const setColumn = (side: "left" | "right", persist: boolean) => (value: number) => {
    update({ ...state, columns: { ...state.columns, [side]: value } }, persist);
  };

  return (
    <div
      ref={windowRef}
      data-testid="app-window"
      className="grid h-full bg-bg text-fg"
      style={{ gridTemplateColumns: `${String(left)}px minmax(0,1fr) ${String(right)}px` }}
    >
      <section
        data-testid="column-projects"
        aria-label="Projects"
        className="relative flex flex-col justify-end border-r border-line bg-side p-4"
      >
        <ToolReadout />
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
    </div>
  );
}
