import { describe, expect, it } from "vitest";
import { repeatedNames, shownParent } from "./project-names.ts";

function parents(names: readonly string[]): (string | undefined)[] {
  const projects = names.map((name, index) => ({ name, parent: `folder${String(index)}` }));
  const repeated = repeatedNames(projects);
  return projects.map((project) => shownParent(project, repeated));
}

describe("shownParent", () => {
  it("shows the parent of two projects that read the same once cleaned", () => {
    for (const pair of [
      ["app", "app!"],
      ["app", "app​"],
      ["café", "café"],
      ["app", "app"],
    ]) {
      expect(parents(pair)).toEqual(["folder0", "folder1"]);
    }
  });

  it("shows no parent for names that read apart", () => {
    expect(parents(["app", "apps", "cafe"])).toEqual([undefined, undefined, undefined]);
  });
});
