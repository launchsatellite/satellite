import type { KeyboardEvent } from "react";
import { tabLabel } from "../pull-request/pull-request-words.ts";

export type CentreView = "changes" | "files" | "pull-request";

const views: readonly CentreView[] = ["changes", "files", "pull-request"];

export function centreTabId(view: CentreView): string {
  return `centre-tab-${view}`;
}

export function centrePanelId(view: CentreView): string {
  return `centre-panel-${view}`;
}

function labelOf(view: CentreView, pullRequest: number | null): string {
  if (view === "pull-request") return tabLabel(pullRequest);
  return view === "changes" ? "Changes" : "Files";
}

export function CentreTabs({
  value,
  pullRequest,
  onChange,
}: {
  value: CentreView;
  pullRequest: number | null;
  onChange: (view: CentreView) => void;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = views.indexOf(value);
    const targets: Record<string, number | undefined> = {
      ArrowRight: (at + 1) % views.length,
      ArrowLeft: (at - 1 + views.length) % views.length,
      Home: 0,
      End: views.length - 1,
    };
    const target = views[targets[event.key] ?? -1];
    if (target === undefined) return;
    event.preventDefault();
    onChange(target);
    requestAnimationFrame(() => {
      document.getElementById(centreTabId(target))?.focus();
    });
  };
  return (
    <div
      role="tablist"
      aria-label="Workspace views"
      data-testid="centre-tabs"
      onKeyDown={move}
      className="flex h-10 min-w-0 items-center gap-0.5"
    >
      {views.map((view) => {
        const selected = view === value;
        return (
          <button
            key={view}
            type="button"
            role="tab"
            id={centreTabId(view)}
            aria-selected={selected}
            aria-controls={centrePanelId(view)}
            tabIndex={selected ? 0 : -1}
            data-testid={centreTabId(view)}
            data-number={view === "pull-request" ? (pullRequest ?? undefined) : undefined}
            onClick={() => {
              onChange(view);
            }}
            className={`flex h-[26px] flex-none items-center rounded-[6px] px-[9px] text-[12px] font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected ? "bg-sel text-fg" : "text-dim hover:bg-hover"}`}
          >
            {labelOf(view, pullRequest)}
          </button>
        );
      })}
    </div>
  );
}
