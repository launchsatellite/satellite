import { describe, expect, it } from "vitest";
import { filesLimits, type FolderListing } from "../../shared/bridge-contract.ts";
import {
  closedFolders,
  matchTyped,
  nearestRow,
  openedFolder,
  treeRows,
  type ItemRow,
} from "./tree-rows.ts";

const listed = (names: string[]): FolderListing => ({
  state: "listed",
  entries: names.map((name) => ({
    name,
    kind: name.includes(".") ? "file" : "folder",
    ignored: false,
  })),
  more: 0,
});

function item(name: string): ItemRow {
  return {
    type: "item",
    path: name,
    name,
    kind: "file",
    ignored: false,
    level: 1,
    setSize: 1,
    position: 1,
    open: false,
  };
}

describe("treeRows", () => {
  it("numbers levels, sets and positions and lists an open folder under its row", () => {
    const rows = treeRows(
      ["", "src"],
      new Map([
        ["", listed(["src", "a.ts"])],
        ["src", listed(["b.ts"])],
      ]),
    );
    expect(
      rows.map((row) => (row.type === "item" ? [row.path, row.level, row.position] : null)),
    ).toEqual([
      ["src", 1, 1],
      ["src/b.ts", 2, 1],
      ["a.ts", 1, 2],
    ]);
  });

  it("says a folder is opening until its listing arrives", () => {
    expect(treeRows([""], new Map()).map((row) => row.type)).toEqual(["note"]);
  });
});

describe("openedFolder", () => {
  const many = Array.from({ length: filesLimits.folders - 1 }, (_, at) => `f${String(at)}`);

  it("closes a folder with nothing open under it when the limit is reached, never an ancestor", () => {
    const open = ["", "a", "a/b", ...many.slice(2)];
    const next = openedFolder(open, "a/b/c");
    expect(next).toHaveLength(filesLimits.folders);
    expect(next).toContain("a");
    expect(next).toContain("a/b");
    expect(next).toContain("a/b/c");
    expect(next).not.toContain("f2");
  });

  it("opens a folder once", () => {
    expect(openedFolder(["", "a"], "a")).toEqual(["", "a"]);
  });
});

describe("closedFolders", () => {
  it("closes what is under a closed folder too", () => {
    expect(closedFolders(["", "a", "a/b", "ab"], ["a"])).toEqual(["", "ab"]);
  });
});

describe("nearestRow", () => {
  it("moves to the closest ancestor that remains, then to a neighbour", () => {
    expect(nearestRow(["a", "a/b", "a/b/c", "d"], ["a", "d"], "a/b/c")).toBe("a");
    expect(nearestRow(["x", "y", "z"], ["x", "z"], "y")).toBe("z");
    expect(nearestRow(["x", "y"], ["x"], "y")).toBe("x");
  });
});

describe("matchTyped", () => {
  const items = [item("alpha"), item("apple"), item("beta")];

  it("finds a name by its start", () => {
    expect(matchTyped(items, 0, "b")).toBe(2);
  });

  it("cycles through names with the same first letter on a repeated key", () => {
    expect(matchTyped(items, 0, "a")).toBe(1);
    expect(matchTyped(items, 1, "aa")).toBe(0);
  });
});
