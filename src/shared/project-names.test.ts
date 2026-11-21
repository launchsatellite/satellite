import { describe, expect, it } from "vitest";
import { repeatedNames, shownParent, shownProject } from "./project-names.ts";

function parents(names: readonly string[]): (string | undefined)[] {
  const projects = names.map((name, index) => ({ name, parent: `folder${String(index)}` }));
  const repeated = repeatedNames(projects);
  return projects.map((project) => shownParent(project, repeated));
}

describe("shownParent", () => {
  it("shows the parent of two projects that read the same once cleaned", () => {
    for (const pair of [
      ["app", "app!"],
      ["app", "app\u{200b}"],
      ["café", "café"],
      ["app", "app"],
    ]) {
      expect(parents(pair)).toEqual(["folder0", "folder1"]);
    }
  });

  it("shows no parent for names that read apart", () => {
    expect(parents(["app", "apps", "cafe"])).toEqual([undefined, undefined, undefined]);
  });

  it("draws the cleaned name it compares, so a direction mark cannot pass for another name", () => {
    const projects = [
      { name: "\u202eppa", parent: "one" },
      { name: "app", parent: "two" },
      { name: "ppa", parent: "<\u2066>" },
    ];
    const repeated = repeatedNames(projects);
    expect(projects.map((project) => shownProject(project, repeated))).toEqual([
      "ppa in one",
      "app",
      "ppa in a folder",
    ]);
  });
});
