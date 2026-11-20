import { describe, expect, it } from "vitest";
import { workspaceNameProblem } from "../../shared/workspace-name.ts";
import { nameAdjectives, nameNouns, suggestName } from "./workspace-names.ts";

describe("suggestName", () => {
  it("suggests only names the shared rule accepts", () => {
    for (const adjective of nameAdjectives) {
      for (const noun of nameNouns) {
        expect(workspaceNameProblem(`${adjective}-${noun}`)).toBeNull();
        expect(workspaceNameProblem(`${adjective}-${noun}-99`)).toBeNull();
      }
    }
    expect(workspaceNameProblem(suggestName(() => false))).toBeNull();
    expect(
      workspaceNameProblem(
        suggestName(
          () => false,
          () => 0.999999,
        ),
      ),
    ).toBeNull();
  });

  it("skips taken names and adds a number when every pair is taken", () => {
    const tried = new Array<string>();
    const taken = (name: string): boolean => {
      tried.push(name);
      return name !== "bright-apex-2";
    };
    expect(suggestName(taken, () => 0)).toBe("bright-apex-2");
    expect(tried).toHaveLength(21);
    expect(
      suggestName(
        () => true,
        () => 0,
      ),
    ).toBe("bright-apex-99");
  });
});
