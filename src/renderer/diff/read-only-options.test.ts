import { describe, expect, it } from "vitest";
import { readOnlyOptions } from "./read-only-options.ts";

describe("readOnlyOptions", () => {
  it("makes the editor refuse edits and every way in", () => {
    expect(readOnlyOptions.readOnly).toBe(true);
    expect(readOnlyOptions.domReadOnly).toBe(true);
    expect(readOnlyOptions.dragAndDrop).toBe(false);
    expect(readOnlyOptions.dropIntoEditor).toEqual({ enabled: false });
    expect(readOnlyOptions.contextmenu).toBe(false);
  });
});
