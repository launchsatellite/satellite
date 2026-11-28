import { visibleText } from "../../shared/visible-text.ts";
import { Tab } from "../ui/tabs.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { tabLabels } from "./tab-labels.ts";

interface FileTabsProps {
  paths: readonly string[];
  active: number | null;
  onClose: (index: number) => void;
}

export const fileTabPanelId = "file-tab-panel";

export function fileTabId(index: number): string {
  return `file-tab-${String(index)}`;
}

export function fileTabValue(path: string): string {
  return `file:${path}`;
}

export function FileTabs({ paths, active, onClose }: FileTabsProps) {
  const labels = tabLabels(paths);
  return paths.map((path, index) => {
    const { name, parent } = labels[index] ?? { name: path, parent: undefined };
    const shown = visibleText(path);
    return (
      <Tab
        key={path}
        value={fileTabValue(path)}
        id={fileTabId(index)}
        panel={index === active ? fileTabPanelId : undefined}
        testId={`file-tab-${String(index)}`}
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
        className="max-w-[200px] min-w-0"
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
  });
}
