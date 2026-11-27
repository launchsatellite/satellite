import { describe, expect, it } from "vitest";
import { movedBefore } from "./project-order.ts";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
const ids = (list: readonly { id: string }[] | undefined) => list?.map((item) => item.id);

describe("movedBefore", () => {
  it("puts the moved project right before its new neighbour, either way", () => {
    expect(ids(movedBefore(items, "c", "a"))).toEqual(["c", "a", "b"]);
    expect(ids(movedBefore(items, "a", "c"))).toEqual(["b", "a", "c"]);
  });

  it("puts it last without a neighbour", () => {
    expect(ids(movedBefore(items, "a", null))).toEqual(["b", "c", "a"]);
  });

  it("answers nothing for a project or neighbour that is gone, so no project is lost", () => {
    expect(movedBefore(items, "x", "a")).toBeUndefined();
    expect(movedBefore(items, "a", "x")).toBeUndefined();
    expect(ids(movedBefore(items, "a", "a"))).toBeUndefined();
  });
});
