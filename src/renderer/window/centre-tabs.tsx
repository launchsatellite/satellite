import type { KeyboardEvent } from "react";

export type CentreView = "changes" | "files";

const views: readonly { value: CentreView; label: string }[] = [
  { value: "changes", label: "Changes" },
  { value: "files", label: "Files" },
];

export function centreTabId(view: CentreView): string {
  return `centre-tab-${view}`;
}

export function centrePanelId(view: CentreView): string {
  return `centre-panel-${view}`;
}

export function CentreTabs({
  value,
  onChange,
}: {
  value: CentreView;
  onChange: (view: CentreView) => void;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = views.findIndex((view) => view.value === value);
    const targets: Record<string, number | undefined> = {
      ArrowRight: (at + 1) % views.length,
      ArrowLeft: (at - 1 + views.length) % views.length,
      Home: 0,
      End: views.length - 1,
    };
    const target = views[targets[event.key] ?? -1];
    if (target === undefined) return;
    event.preventDefault();
    onChange(target.value);
    requestAnimationFrame(() => {
      document.getElementById(centreTabId(target.value))?.focus();
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
        const selected = view.value === value;
        return (
          <button
            key={view.value}
            type="button"
            role="tab"
            id={centreTabId(view.value)}
            aria-selected={selected}
            aria-controls={centrePanelId(view.value)}
            tabIndex={selected ? 0 : -1}
            data-testid={centreTabId(view.value)}
            onClick={() => {
              onChange(view.value);
            }}
            className={`flex h-[26px] flex-none items-center rounded-[6px] px-[9px] text-[12px] font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected ? "bg-sel text-fg" : "text-dim hover:bg-hover"}`}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
}
