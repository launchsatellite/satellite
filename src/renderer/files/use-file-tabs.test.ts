import { describe, expect, it } from "vitest";
import { filesLimits, type FileTabs } from "../../shared/bridge-contract.ts";
import { pruneTabs, tabsAfterClose, tabsAfterOpen } from "./use-file-tabs.ts";

const ids = Array.from(
  { length: 101 },
  (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
);
const tabs = (index: number): FileTabs => ({
  projectId: ids[index] ?? "",
  workspace: "main",
  paths: ["a"],
  active: 0,
});

describe("file tabs", () => {
  it("opens a path once, closes the leftmost at the limit, moves the active tab on close, and prunes workspaces that are gone and keeps at most 50", () => {
    const twice = tabsAfterOpen(tabsAfterOpen(undefined, "a"), "a");
    expect(twice).toEqual({ paths: ["a"], active: 0 });
    expect(tabsAfterOpen({ paths: ["a", "b"], active: 1 }, "a").active).toBe(0);

    const names = Array.from(
      { length: filesLimits.tabsPerWorkspace },
      (_, index) => `f${String(index)}`,
    );
    const full = tabsAfterOpen({ paths: names, active: 0 }, "new");
    expect(full.paths).toHaveLength(filesLimits.tabsPerWorkspace);
    expect(full.paths[0]).toBe("f1");
    expect(full.paths.at(-1)).toBe("new");
    expect(full.active).toBe(filesLimits.tabsPerWorkspace - 1);

    expect(tabsAfterClose({ paths: ["a", "b", "c"], active: 1 }, 1)).toEqual({
      paths: ["a", "c"],
      active: 1,
    });
    expect(tabsAfterClose({ paths: ["a", "b", "c"], active: 2 }, 2)).toEqual({
      paths: ["a", "b"],
      active: 1,
    });
    expect(tabsAfterClose({ paths: ["a", "b", "c"], active: 2 }, 0)).toEqual({
      paths: ["b", "c"],
      active: 1,
    });
    expect(tabsAfterClose({ paths: ["a"], active: 0 }, 0)).toBeNull();

    const all = ids.map((_, index) => tabs(index));
    expect(pruneTabs(all, () => true)).toHaveLength(filesLimits.tabbedWorkspaces);
    expect(pruneTabs(all, ({ projectId }) => projectId === ids[3])).toEqual([tabs(3)]);
  });
});
