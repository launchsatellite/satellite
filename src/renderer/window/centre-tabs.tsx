import { tabLabel } from "../pull-request/pull-request-words.ts";
import { Tab, Tabs } from "../ui/tabs.tsx";

export type CentreView = "changes" | "files" | "pull-request";

const views: readonly CentreView[] = ["files", "changes", "pull-request"];

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
  return (
    <div className="flex h-10 min-w-0 items-center overflow-x-auto [scrollbar-width:none]">
      <Tabs
        label="Workspace views"
        value={value}
        onChange={(next) => {
          const view = views.find((candidate) => candidate === next);
          if (view === undefined) return;
          const fromKeys = document.activeElement?.matches(":focus-visible") === true;
          onChange(view);
          if (fromKeys) {
            requestAnimationFrame(() => {
              document.getElementById(centreTabId(view))?.focus();
            });
          }
        }}
        testId="centre-tabs"
        activateOnFocus
        data-guide="views"
      >
        {views.map((view) => (
          <Tab
            key={view}
            value={view}
            id={centreTabId(view)}
            panel={centrePanelId(view)}
            testId={centreTabId(view)}
            data-number={view === "pull-request" ? (pullRequest ?? undefined) : undefined}
          >
            {labelOf(view, pullRequest)}
          </Tab>
        ))}
      </Tabs>
    </div>
  );
}
