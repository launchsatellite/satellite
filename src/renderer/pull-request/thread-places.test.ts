import { describe, expect, it } from "vitest";
import type { ChangesList, PullRequestThread } from "../../shared/bridge-contract.ts";
import { fileStateOf, threadPlaces } from "./thread-places.ts";

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

describe("fileStateOf", () => {
  const changed = (path: string, from: string | null = null) => ({
    path,
    from,
    letter: "M" as const,
    tracked: true,
    kind: "text" as const,
    added: 1,
    removed: 0,
    stamp: "s",
  });
  const files = (list: ReturnType<typeof changed>[], more = 0, longPaths = 0) => ({
    kind: "files" as const,
    files: list,
    more,
    longPaths,
  });
  const unavailable: ChangesList["changes"] = { kind: "unavailable", reason: "hung" };

  it("is clean only when the list is whole and the file is not in it", () => {
    expect(fileStateOf(files([changed("src/other.ts")]), "src/app.ts")).toBe("clean");
    expect(fileStateOf(files([]), "src/app.ts")).toBe("clean");
  });

  it("is changed for the file itself and for the old name of a renamed one", () => {
    expect(fileStateOf(files([changed("src/app.ts")]), "src/app.ts")).toBe("changed");
    expect(fileStateOf(files([changed("src/new.ts", "src/app.ts")]), "src/app.ts")).toBe("changed");
  });

  it("is unknown when the list is cut or unavailable and loading before it comes", () => {
    expect(fileStateOf(files([], 3), "src/app.ts")).toBe("unknown");
    expect(fileStateOf(files([], 0, 1), "src/app.ts")).toBe("unknown");
    expect(fileStateOf(unavailable, "src/app.ts")).toBe("unknown");
    expect(fileStateOf(undefined, "src/app.ts")).toBe("loading");
  });
});
