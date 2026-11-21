import { describe, expect, it } from "vitest";
import { cleanBase, conflictRequest } from "./prompt-requests.ts";

describe("conflictRequest", () => {
  it("asks to update from a base named by Satellite's words only", () => {
    expect(conflictRequest("origin/main")).toBe(
      "Update this branch from origin/main and resolve the conflicts.",
    );
    for (const base of ["a\u{202e}b", "two words", 'quo"te', "back`tick", "it's", "", null]) {
      expect(cleanBase(base)).toBe("the base branch");
    }
  });
});
