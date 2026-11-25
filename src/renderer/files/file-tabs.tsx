import { useEffect } from "react";
import { visibleText } from "../../shared/visible-text.ts";
import { Tab, Tabs } from "../ui/tabs.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { tabLabels } from "./tab-labels.ts";

interface FileTabsProps {
  paths: readonly string[];
  active: number | null;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
}

export const fileTabPanelId = "file-tab-panel";

export function fileTabId(index: number): string {
  return `file-tab-${String(index)}`;
}

export function FileTabs({ paths, active, onActivate, onClose }: FileTabsProps) {
  useEffect(() => {
    if (active === null) return;
    document
      .getElementById(fileTabId(active))
      ?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  const labels = tabLabels(paths);
  return (
    <Tabs
      label="Open files"
      value={active === null ? null : (paths[active] ?? null)}
      onChange={(path) => {
        const index = paths.indexOf(path);
        if (index !== -1) onActivate(index);
      }}
      testId="file-tabs"
      activateOnFocus
      className="h-8 flex-none overflow-x-auto border-b border-line bg-side px-2 [scrollbar-width:none]"
    >
      {paths.map((path, index) => {
        const { name, parent } = labels[index] ?? { name: path, parent: undefined };
        const shown = visibleText(path);
        return (
          <Tab
            key={path}
            value={path}
            id={fileTabId(index)}
            panel={index === active ? fileTabPanelId : undefined}
            testId={`file-tab-${String(index)}`}
            size="small"
            label={shown}
            tooltip={shown}
            close={{
              label: `Close ${visibleText(name)}`,
              testId: `file-tab-${String(index)}-close`,
              onClose: () => {
                onClose(index);
              },
            }}
            data-path={path}
            className="max-w-[180px] min-w-0"
          >
            <span aria-hidden dir="ltr" className="min-w-0 truncate [unicode-bidi:isolate]">
              <VisibleName text={name} />
              {parent !== undefined && (
                <span className="ml-1.5 text-dim">
                  <VisibleName text={parent} />
                </span>
              )}
            </span>
          </Tab>
        );
      })}
    </Tabs>
  );
}
