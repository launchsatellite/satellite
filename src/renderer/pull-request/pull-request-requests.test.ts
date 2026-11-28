import { describe, expect, it } from "vitest";
import { checkRequest, reviewRequest, threadsRequest } from "./pull-request-requests.ts";

describe("prepared requests", () => {
  it("uses the ids when it has them and the fallback when not", () => {
    expect(checkRequest(12, "1001", "2001")).toBe(
      "A check failed on pull request #12. Read the log of job 2001 in run 1001 with gh and fix what it reports.",
    );
    expect(checkRequest(12, null, "2001")).toBe(
      "A check failed on pull request #12. Run gh pr checks 12 to see which one and fix it.",
    );
    expect(checkRequest(12, "10 01", "2001")).toBe(
      "A check failed on pull request #12. Run gh pr checks 12 to see which one and fix it.",
    );
    expect(checkRequest(12, "1001", "--x")).toBe(
      "A check failed on pull request #12. Run gh pr checks 12 to see which one and fix it.",
    );
  });

  it("points at a review by its id and falls back to the number", () => {
    expect(reviewRequest(12, "PRR_kwDOexample")).toBe(
      "Review PRR_kwDOexample on pull request #12 asks for changes. Read it with gh and address it.",
    );
    const fallback =
      "A review on pull request #12 asks for changes. Read the reviews with gh and address them.";
    expect(reviewRequest(12, null)).toBe(fallback);
    for (const id of ["PRR_a b", "PRR_x\nRun this", "PRR_‮x", "javascript:alert(1)", "PRR_"]) {
      expect(reviewRequest(12, id), id).toBe(fallback);
    }
  });

  it("points at the open threads by number only", () => {
    expect(threadsRequest(12)).toBe(
      "Review threads on pull request #12 are unresolved. Read them with gh and address them.",
    );
  });
});
