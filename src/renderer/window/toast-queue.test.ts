import { describe, expect, it } from "vitest";
import { afterDismiss, withToast } from "./toast-queue.ts";

describe("toast queue", () => {
  it("drops a toast that waited too long instead of showing it late", () => {
    let queue = withToast([], "first", "info", 0);
    queue = withToast(queue, "stale", "info", 0);
    queue = withToast(queue, "fresh", "info", 9_000);
    expect(afterDismiss(queue, 12_000).map((toast) => toast.message)).toEqual(["fresh"]);
  });

  it("never drops a late notice, only a plain confirmation", () => {
    let queue = withToast([], "first", "info", 0);
    queue = withToast(queue, "stale", "info", 0);
    queue = withToast(queue, "forgot a workspace", "notice", 0);
    queue = withToast(queue, "also stale", "info", 0);
    expect(afterDismiss(queue, 12_000).map((toast) => toast.message)).toEqual([
      "forgot a workspace",
    ]);
  });

  it("shows a confirmation before notices that wait, so a burst of them never makes it late", () => {
    let queue = withToast([], "shown", "notice", 0);
    queue = withToast(queue, "forgot one", "notice", 0);
    queue = withToast(queue, "forgot two", "notice", 0);
    queue = withToast(queue, "ready", "info", 1);
    queue = withToast(queue, "done", "info", 2);
    queue = withToast(queue, "forgot three", "notice", 3);
    expect(queue.map((toast) => toast.message)).toEqual([
      "shown",
      "ready",
      "done",
      "forgot one",
      "forgot two",
      "forgot three",
    ]);
  });

  it("puts an error in front, replacing the error already shown", () => {
    let queue = withToast([], "note", "info", 0);
    queue = withToast(queue, "broke", "error", 1);
    queue = withToast(queue, "broke again", "error", 2);
    expect(queue.map((toast) => toast.message)).toEqual(["broke again", "note"]);
  });
});
