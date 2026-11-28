import type { ReactNode } from "react";
import { CommandButton } from "../commands/commands-context.tsx";
import { tabLabel } from "../pull-request/pull-request-words.ts";
import { Button } from "../ui/button.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { Tab, Tabs } from "../ui/tabs.tsx";

export type RailView = "changes" | "files" | "pull-request";

interface RailProps {
  view: RailView;
  folded: boolean;
  shown: boolean;
  pullRequest: number | null;
  onView: (view: RailView) => void;
  onUnfold: (view: RailView) => void;
  children: ReactNode;
}

const views: readonly { view: RailView; icon: IconName }[] = [
  { view: "changes", icon: "diff" },
  { view: "files", icon: "folder" },
  { view: "pull-request", icon: "pull-request" },
];

function labelOf(view: RailView, pullRequest: number | null): string {
  if (view === "pull-request") return tabLabel(pullRequest);
  return view === "changes" ? "Changes" : "Files";
}

export function railTabId(view: RailView): string {
  return `rail-tab-${view}`;
}

export function railPanelId(view: RailView): string {
  return `rail-panel-${view}`;
}

export function Rail({ view, folded, shown, pullRequest, onView, onUnfold, children }: RailProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!shown ? null : folded ? (
        <nav
          aria-label="Workspace views"
          data-guide="views"
          className="flex flex-col items-center gap-1 pt-2"
        >
          {views.map((shown) => (
            <Button
              key={shown.view}
              variant="ghost"
              size="small"
              icon={shown.icon}
              label={labelOf(shown.view, pullRequest)}
              tooltip={labelOf(shown.view, pullRequest)}
              testId={railTabId(shown.view)}
              data-number={shown.view === "pull-request" ? (pullRequest ?? undefined) : undefined}
              onClick={() => {
                onUnfold(shown.view);
              }}
            />
          ))}
        </nav>
      ) : (
        <div className="flex h-11 flex-none items-center gap-1 px-2">
          <Tabs
            label="Workspace views"
            value={view}
            onChange={(next) => {
              const picked = views.find((candidate) => candidate.view === next);
              if (picked !== undefined) onView(picked.view);
            }}
            testId="rail-tabs"
            activateOnFocus
            data-guide="views"
          >
            {views.map((shown) => (
              <Tab
                key={shown.view}
                value={shown.view}
                id={railTabId(shown.view)}
                panel={railPanelId(shown.view)}
                testId={railTabId(shown.view)}
                label={labelOf(shown.view, pullRequest)}
                tooltip={labelOf(shown.view, pullRequest)}
                data-number={shown.view === "pull-request" ? (pullRequest ?? undefined) : undefined}
              >
                <Icon name={shown.icon} />
              </Tab>
            ))}
          </Tabs>
          <span className="flex-1" />
          <CommandButton
            command="rail.toggle"
            variant="ghost"
            size="small"
            icon="rail"
            label="Hide the rail"
            tooltip="Hide the rail"
            testId="rail-hide"
          />
        </div>
      )}
      <div hidden={folded} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
