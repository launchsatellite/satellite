import { describe, expect, it } from "vitest";
import { fuzzyScore, rankMatches } from "./fuzzy-match.ts";

const identity = (text: string) => text;

describe("fuzzyScore", () => {
  it("matches a subsequence in any case", () => {
    expect(fuzzyScore("ADP", "Add a project")).toBeDefined();
  });

  it("refuses letters out of order or missing", () => {
    expect(fuzzyScore("xyz", "Add a project")).toBeUndefined();
    expect(fuzzyScore("tc", "Check")).toBeUndefined();
  });

  it("ignores spaces in the query", () => {
    expect(fuzzyScore("be ma", "beta main")).toBeDefined();
  });
});

describe("rankMatches", () => {
  it("ranks consecutive word-start matches first", () => {
    expect(rankMatches("rem", ["Use the dark theme", "Remove project"], identity)[0]).toBe(
      "Remove project",
    );
  });

  it("keeps the input order for an empty query", () => {
    const items = ["b", "a", "c"];
    expect(rankMatches("", items, identity)).toEqual(items);
  });
});
