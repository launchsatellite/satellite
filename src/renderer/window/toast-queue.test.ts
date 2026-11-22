import { describe, expect, it } from "vitest";
import { afterDismiss, withToast } from "./toast-queue.ts";

describe("toast queue", () => {
  it("drops a toast that waited too long instead of showing it late", () => {
    let queue = withToast([], "first", "info", 0);
    queue = withToast(queue, "stale", "info", 0);
    queue = withToast(queue, "fresh", "info", 9_000);
    expect(afterDismiss(queue, 12_000).map((toast) => toast.message)).toEqual(["fresh"]);
  });

  it("puts an error in front, replacing the error already shown", () => {
    let queue = withToast([], "note", "info", 0);
    queue = withToast(queue, "broke", "error", 1);
    queue = withToast(queue, "broke again", "error", 2);
    expect(queue.map((toast) => toast.message)).toEqual(["broke again", "note"]);
  });
});
