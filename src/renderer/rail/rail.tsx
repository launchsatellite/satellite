import type { ReactNode } from "react";
import { CommandButton } from "../commands/commands-context.tsx";
import { Button } from "../ui/button.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { Tab, Tabs } from "../ui/tabs.tsx";

export type RailView = "changes" | "files" | "ready";

interface RailProps {
  view: RailView;
  folded: boolean;
  shown: boolean;
  pullRequest: number | null;
  readyNeedsYou: boolean;
  onView: (view: RailView) => void;
  onUnfold: (view: RailView) => void;
  children: ReactNode;
}

const views: readonly { view: RailView; icon: IconName }[] = [
  { view: "changes", icon: "diff" },
  { view: "files", icon: "folder" },
  { view: "ready", icon: "pull-request" },
];
const labels: Record<RailView, string> = { changes: "Changes", files: "Files", ready: "Ready" };

function NeedsYou({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <span data-testid="rail-ready-needs-you" className="pointer-events-none absolute top-1 right-1 flex">
      <StatusPixel state="needs-you" size={6} />
    </span>
  );
}

export function railTabId(view: RailView): string {
  return `rail-tab-${view}`;
}

export function railPanelId(view: RailView): string {
  return `rail-panel-${view}`;
}

export function Rail({
  view,
  folded,
  shown,
  pullRequest,
  readyNeedsYou,
  onView,
  onUnfold,
  children,
}: RailProps) {
  const numberOf = (of: RailView) => (of === "ready" ? (pullRequest ?? undefined) : undefined);
  const needsYouOn = (of: RailView) => of === "ready" && readyNeedsYou;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!shown ? null : folded ? (
        <nav
          aria-label="Workspace views"
          data-guide="views"
          className="flex flex-col items-center gap-1 pt-2"
        >
          {views.map((shown) => (
            <span key={shown.view} className="relative flex">
              <Button
                variant="ghost"
                size="small"
                icon={shown.icon}
                label={labels[shown.view]}
                tooltip={labels[shown.view]}
                testId={railTabId(shown.view)}
                data-number={numberOf(shown.view)}
                onClick={() => {
                  onUnfold(shown.view);
                }}
              />
              <NeedsYou shown={needsYouOn(shown.view)} />
            </span>
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
                label={labels[shown.view]}
                tooltip={labels[shown.view]}
                description={needsYouOn(shown.view) ? "Needs you" : undefined}
                data-number={numberOf(shown.view)}
                className="relative"
              >
                <Icon name={shown.icon} />
                <NeedsYou shown={needsYouOn(shown.view)} />
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
