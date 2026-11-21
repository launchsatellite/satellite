import { describe, expect, it } from "vitest";
import type { PullRequestDetail } from "../../shared/bridge-contract.ts";
import { conversationItems, threadOrder } from "./thread-order.ts";

type Read = Extract<PullRequestDetail, { kind: "read" }>;

function comment(at: string | null, body = "x") {
  return { author: "ada-example", at, body, bodyCut: false, hidden: false, url: null };
}

function thread(
  resolved: boolean,
  at: string | null,
  path: string | null = null,
  line: number | null = null,
) {
  return {
    resolved,
    outdated: false,
    path,
    line,
    side: null,
    url: null,
    comments: [comment(at)],
    moreComments: 0,
  };
}

function detail(change: Partial<Read>): Read {
  return {
    kind: "read",
    reviews: [],
    moreReviews: 0,
    comments: [],
    moreComments: 0,
    threads: [],
    moreThreads: 0,
    ...change,
  };
}

describe("conversation order", () => {
  it("puts unresolved threads first and resolved last", () => {
    const items = conversationItems(
      detail({
        threads: [
          thread(true, "2025-01-01T00:00:00Z"),
          thread(false, "2025-01-03T00:00:00Z"),
          thread(false, "2025-01-02T00:00:00Z"),
        ],
        comments: [comment("2025-01-01T12:00:00Z")],
      }),
    );
    expect(
      items.map((item) => (item.kind === "thread" ? `t${String(item.index)}` : item.kind)),
    ).toEqual(["t2", "t1", "comment", "t0"]);
  });

  it("orders reviews and comments by time and survives a missing time", () => {
    const items = conversationItems(
      detail({
        comments: [comment("2025-01-02T00:00:00Z", "late"), comment(null, "none")],
        reviews: [
          {
            ...comment("2025-01-01T00:00:00Z", "early"),
            state: "approved",
          },
          { ...comment("not a time", "odd"), state: "commented" },
        ],
      }),
    );
    const bodies = items.map((item) =>
      item.kind === "review" ? item.review.body : item.kind === "comment" ? item.comment.body : "",
    );
    expect(bodies).toEqual(["early", "late", "odd", "none"]);
  });

  it("orders the unresolved by path then line", () => {
    const order = threadOrder(
      detail({
        threads: [
          thread(false, null, null),
          thread(false, null, "src/b.ts", 3),
          thread(true, null, "src/a.ts", 1),
          thread(false, null, "src/a.ts", 9),
          thread(false, null, "src/a.ts", 2),
          thread(false, null, "src/a.ts", null),
        ],
      }),
    );
    expect(order).toEqual([4, 3, 5, 1, 0]);
  });
});
