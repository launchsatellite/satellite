import { describe, expect, it } from "vitest";
import type { PullRequestThread } from "../../shared/bridge-contract.ts";
import { threadPlaces } from "./thread-places.ts";

function thread(over: Partial<PullRequestThread>): PullRequestThread {
  return {
    resolved: false,
    outdated: false,
    path: "src/app.ts",
    line: 2,
    side: "right",
    url: null,
    comments: [],
    moreComments: 0,
    ...over,
  };
}

function detailOf(threads: PullRequestThread[]) {
  return {
    kind: "read" as const,
    reviews: [],
    moreReviews: 0,
    comments: [],
    moreComments: 0,
    threads,
    moreThreads: 0,
  };
}

describe("threadPlaces", () => {
  it("lists every thread of the file and marks none when lines cannot be trusted", () => {
    const places = threadPlaces(
      detailOf([thread({ line: 7 }), thread({ line: 9 })]),
      "src/app.ts",
      false,
    );
    expect(places).toEqual({ marks: [], listed: [0, 1] });
  });

  it("marks a right side thread on its line", () => {
    const places = threadPlaces(detailOf([thread({ line: 7 })]), "src/app.ts");
    expect(places).toEqual({ marks: [{ line: 7, threads: [0], unresolved: true }], listed: [] });
  });

  it("groups two threads on one line", () => {
    const places = threadPlaces(
      detailOf([thread({ resolved: true }), thread({}), thread({ line: 1 })]),
      "src/app.ts",
    );
    expect(places.marks).toEqual([
      { line: 1, threads: [2], unresolved: true },
      { line: 2, threads: [1, 0], unresolved: true },
    ]);
  });

  it("lists outdated, left side and file level threads without a mark", () => {
    const places = threadPlaces(
      detailOf([
        thread({ outdated: true, line: null }),
        thread({ side: "left" }),
        thread({ line: null }),
        thread({ outdated: true }),
        thread({ side: null }),
      ]),
      "src/app.ts",
    );
    expect(places.marks).toEqual([]);
    expect(places.listed).toEqual([0, 1, 2, 3, 4]);
  });

  it("ignores threads of other files", () => {
    const places = threadPlaces(
      detailOf([
        thread({ path: "src/other.ts" }),
        thread({ path: null }),
        thread({ path: "src/app.tsx" }),
      ]),
      "src/app.ts",
    );
    expect(places).toEqual({ marks: [], listed: [] });
  });

  it("a line is unresolved when any thread on it is", () => {
    const resolvedOnly = threadPlaces(detailOf([thread({ resolved: true })]), "src/app.ts");
    expect(resolvedOnly.marks[0]?.unresolved).toBe(false);
    const mixed = threadPlaces(detailOf([thread({ resolved: true }), thread({})]), "src/app.ts");
    expect(mixed.marks[0]?.unresolved).toBe(true);
  });
});
