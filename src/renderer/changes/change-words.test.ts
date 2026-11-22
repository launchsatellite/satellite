import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../../shared/bridge-contract.ts";
import { rowName } from "./change-words.ts";

const file: ChangedFile = {
  path: "src/app.ts",
  from: null,
  letter: "M",
  tracked: true,
  kind: "text",
  added: 2,
  removed: 1,
  stamp: "s",
};

describe("rowName", () => {
  it("starts with what the row shows, then says it in words", () => {
    expect(rowName(file)).toBe("M src/app.ts +2 −1, modified, 2 added, 1 removed");
  });

  it("leaves out a count the row does not show", () => {
    expect(rowName({ ...file, letter: "A", tracked: false, added: 1, removed: 0 })).toBe(
      "A src/app.ts +1, added, not tracked yet, 1 added, 0 removed",
    );
  });
});
