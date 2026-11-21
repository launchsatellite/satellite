import { describe, expect, it } from "vitest";
import { tabLabels } from "./tab-labels.ts";

describe("tabLabels", () => {
  it("names a parent only when two tabs share a file name", () => {
    expect(tabLabels(["src/a/index.ts", "src/b/index.ts", "README.md"])).toEqual([
      { name: "index.ts", parent: "a" },
      { name: "index.ts", parent: "b" },
      { name: "README.md", parent: undefined },
    ]);
  });

  it("goes up until the folders differ", () => {
    expect(tabLabels(["x/a/index.ts", "y/a/index.ts"])).toEqual([
      { name: "index.ts", parent: "x/a" },
      { name: "index.ts", parent: "y/a" },
    ]);
  });

  it("tells a file at the root from one in a folder", () => {
    expect(tabLabels(["index.ts", "src/index.ts"])).toEqual([
      { name: "index.ts", parent: undefined },
      { name: "index.ts", parent: "src" },
    ]);
  });
});
