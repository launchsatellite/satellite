import { describe, expect, it } from "vitest";
import { baseRequest, checkRequest, threadRequest } from "./pull-request-requests.ts";

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

  it("keeps a thread address and falls back without one", () => {
    const url = "https://github.com/example-org/verify-repo/pull/12#discussion_r3001";
    expect(threadRequest(12, url)).toBe(
      `A review thread on pull request #12 needs an answer in the code. Read it with gh at ${url} and address it.`,
    );
    const fallback =
      "Review threads on pull request #12 are unresolved. Read them with gh and address them.";
    expect(threadRequest(12, null)).toBe(fallback);
    expect(threadRequest(12, "https://github.com/a/b/pull/12#discussion_r1 and more")).toBe(
      fallback,
    );
    expect(threadRequest(12, "https://github.com/a/b/pull/12‮#discussion_r1")).toBe(fallback);
    expect(threadRequest(12, "javascript:alert(1)")).toBe(fallback);
  });

  it("cleans the base", () => {
    expect(baseRequest("origin/main")).toBe(
      "Fetch origin/main from the remote so Satellite can show this pull request's files.",
    );
    for (const base of ["a‮b", "two words", "@x", null, "it's"]) {
      expect(baseRequest(base)).toBe(
        "Fetch the base branch from the remote so Satellite can show this pull request's files.",
      );
    }
  });
});
