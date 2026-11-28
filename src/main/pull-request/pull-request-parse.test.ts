import { describe, expect, it } from "vitest";
import { pullRequestAnswer, pullRequestLimits } from "../../shared/bridge-contract.ts";
import type { PullRequestPlace } from "./gh-arguments.ts";
import { failedLines, parseConversation, parseView } from "./pull-request-parse.ts";

const head = "a".repeat(40);
const address = "https://github.com/example-org/verify-repo/pull/12";
const place: PullRequestPlace = {
  host: "github.com",
  owner: "example-org",
  repo: "verify-repo",
  number: 12,
};
const job = "https://github.com/example-org/verify-repo/actions/runs/1001/job/2001";

function parseThreads(text: string) {
  return parseConversation(text, true)?.detail ?? null;
}

function view(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 12,
    url: address,
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature/widget",
    headRefOid: head,
    isCrossRepository: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "REVIEW_REQUIRED",
    reviews: [
      {
        id: "PRR_kwDOgrace",
        state: "APPROVED",
        commit: head,
        login: "grace-example",
        association: "MEMBER",
        at: "2026-01-02T00:00:00Z",
      },
    ],
    checks: [
      { name: "build", workflow: "ci", status: "COMPLETED", conclusion: "SUCCESS", url: job },
      { context: "ci/lint", state: "PENDING", url: "https://ci.example.com/lint" },
    ],
    commits: [{ oid: "b".repeat(40), headline: "Add it" }],
    ...changes,
  };
}

const read = (value: unknown) => parseView(JSON.stringify(value));

describe("parseView", () => {
  it("reads a full answer", () => {
    const answer = read(view());
    expect(answer?.place).toEqual(place);
    expect(answer?.headOid).toBe(head);
    expect(answer?.found).toEqual({
      kind: "found",
      number: 12,
      url: address,
      host: "github.com",
      state: "open",
      base: "main",
      head: "feature/widget",
      crossRepository: false,
      mergeable: "mergeable",
      mergeState: "clean",
      review: "review-required",
      reviewers: [{ login: "grace-example", state: "approved", onHead: true, id: "PRR_kwDOgrace" }],
      counts: { failed: 0, pending: 1, passed: 1, total: 2 },
      needs: [],
      commits: [{ oid: "bbbbbbb", headline: "Add it" }],
      moreCommits: 0,
      checks: [
        {
          name: "ci/lint",
          workflow: null,
          result: "pending",
          url: "https://ci.example.com/lint",
          run: null,
          job: null,
        },
        { name: "build", workflow: "ci", result: "passed", url: job, run: "1001", job: "2001" },
      ],
      moreChecks: 0,
    });
    expect(pullRequestAnswer.safeParse({ ...answer?.found, detail: null }).success).toBe(true);
  });

  it("reads each state", () => {
    expect(read(view({ state: "MERGED" }))?.found.state).toBe("merged");
    expect(read(view({ state: "CLOSED" }))?.found.state).toBe("closed");
    expect(read(view({ isDraft: true }))?.found.state).toBe("draft");
    expect(read(view({ state: "ODD" }))?.found.state).toBe("open");
  });

  it("a missing field costs only that field", () => {
    for (const key of Object.keys(view())) {
      const without = view();
      Reflect.deleteProperty(without, key);
      const answer = read(without);
      if (key === "number" || key === "url") {
        expect(answer, key).toBeNull();
        continue;
      }
      expect(answer?.found.kind, key).toBe("found");
      expect(pullRequestAnswer.safeParse({ ...answer?.found, detail: null }).success, key).toBe(
        true,
      );
    }
    const bare = read({ number: 12, url: address });
    expect(bare?.found).toMatchObject({
      state: "open",
      base: null,
      head: null,
      mergeable: "unknown",
      mergeState: "unknown",
      review: "none",
      reviewers: [],
      commits: [],
      checks: [],
      needs: [],
    });
  });

  it("degrades a field of the wrong type to its empty value", () => {
    const answer = read(
      view({
        isDraft: "yes",
        checks: "x",
        commits: { a: 1 },
        reviews: 7,
      }),
    );
    expect(answer?.found).toMatchObject({
      state: "open",
      reviewers: [],
      checks: [],
      commits: [],
    });
  });

  it("refuses an answer with no number or an address that placeOf refuses", () => {
    expect(read(view({ number: 0 }))).toBeNull();
    expect(read(view({ number: 1.5 }))).toBeNull();
    expect(read(view({ number: "12" }))).toBeNull();
    for (const url of [
      "http://github.com/example-org/verify-repo/pull/12",
      `${address}?x=1`,
      "https://github.com/example-org/verify-repo/issues/12",
      "",
    ]) {
      expect(read(view({ url })), url).toBeNull();
    }
  });

  it("never throws on text that is not JSON", () => {
    for (const text of ["", "not json", "{", "null", "[]", "42", '"x"', "{}"]) {
      expect(parseView(text), text).toBeNull();
      expect(parseThreads(text), text).toBeNull();
      expect(failedLines(text).lines).toBeDefined();
    }
  });

  it("cuts a long headline and list and counts the rest", () => {
    const checks = Array.from({ length: 130 }, (_, index) => ({
      name: `check-${String(index).padStart(3, "0")}`,
      workflow: "ci",
      status: "COMPLETED",
      conclusion: index === 129 ? "FAILURE" : "SUCCESS",
    }));
    const commits = Array.from({ length: 105 }, (_, index) => ({
      oid: String(index % 10).repeat(40),
      headline: "h".repeat(300),
    }));
    const found = read(view({ checks, commits }))?.found;
    expect(found?.checks).toHaveLength(100);
    expect(found?.moreChecks).toBe(30);
    expect(found?.counts).toEqual({ failed: 1, pending: 0, passed: 129, total: 130 });
    expect(found?.needs).toEqual(["checks"]);
    expect(found?.commits).toHaveLength(100);
    expect(found?.moreCommits).toBe(5);
    expect(found?.commits[0]?.headline).toHaveLength(256);
  });

  it("does not split a character when it cuts", () => {
    const found = read(view({ commits: [{ oid: head, headline: `${"h".repeat(255)}😀` }] }))?.found;
    expect(found?.commits[0]?.headline).toBe("h".repeat(255));
  });

  it("an empty review decision and an unknown merge state are none and unknown", () => {
    const found = read(
      view({ reviewDecision: "", mergeStateStatus: "SOMETHING", mergeable: "" }),
    )?.found;
    expect(found).toMatchObject({ review: "none", mergeState: "unknown", mergeable: "unknown" });
    expect(read(view({ reviewDecision: null }))?.found.review).toBe("none");
    expect(read(view({ mergeStateStatus: "HAS_HOOKS" }))?.found.mergeState).toBe("has-hooks");
    expect(read(view({ reviewDecision: "CHANGES_REQUESTED" }))?.found.review).toBe(
      "changes-requested",
    );
    expect(read(view({ mergeable: "CONFLICTING" }))?.found.mergeable).toBe("conflicting");
  });

  it("drops a commit with a bad oid", () => {
    const found = read(
      view({
        commits: [
          { oid: "xyz", headline: "bad" },
          { oid: "B".repeat(40), headline: "upper" },
          { headline: "none" },
          { oid: "c".repeat(40), headline: "good" },
        ],
      }),
    )?.found;
    expect(found?.commits).toEqual([{ oid: "ccccccc", headline: "good" }]);
  });

  it("reads a branch name that is not one as null", () => {
    expect(read(view({ headRefName: "-bad name", baseRefName: "a..b" }))?.found).toMatchObject({
      head: null,
      base: null,
    });
  });

  it("puts what needs you in the answer", () => {
    const found = read(
      view({
        mergeable: "CONFLICTING",
        reviews: [
          {
            id: "PRR_kwDOada",
            state: "CHANGES_REQUESTED",
            commit: head,
            login: "ada-example",
            association: "OWNER",
            at: "2026-01-01T00:00:00Z",
          },
        ],
        checks: [{ name: "build", status: "COMPLETED", conclusion: "FAILURE" }],
      }),
    )?.found;
    expect(found?.needs).toEqual(["checks", "review", "conflicts"]);
    const stranger = read(
      view({
        reviews: [
          {
            state: "CHANGES_REQUESTED",
            commit: head,
            login: "passer-by",
            association: "NONE",
            at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    )?.found;
    expect(stranger?.needs).toEqual([]);
    expect(read(view({ state: "MERGED", mergeable: "CONFLICTING" }))?.found.needs).toEqual([]);
  });
});

const threadsAnswer = (pullRequest: unknown) =>
  JSON.stringify({ data: { repository: { pullRequest } } });
const full = () => ({
  reviewThreads: {
    totalCount: 3,
    nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }],
  },
});

describe("check addresses", () => {
  it("an odd details address is normalised and never drops the answer", () => {
    for (const url of [
      "HTTPS://CI.Example.com/lint",
      " https://ci.example.com/lint",
      "https:/ci.example.com/lint",
      "https://ci.example.com/a\u202Eb",
    ]) {
      const found = parseView(
        JSON.stringify(
          view({ checks: [{ name: "lint", status: "COMPLETED", conclusion: "SUCCESS", url }] }),
        ),
      )?.found;
      expect(pullRequestAnswer.safeParse({ ...found, detail: null }).success, url).toBe(true);
      expect(found?.checks[0]?.url, url).toMatch(/^https:\/\/ci\.example\.com\//);
    }
    const credentials = parseView(
      JSON.stringify(
        view({
          checks: [
            {
              name: "lint",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              url: "https://user:secret@ci.example.com/lint",
            },
          ],
        }),
      ),
    )?.found;
    expect(credentials?.checks[0]?.url).toBeNull();
  });

  it("refuses a number that is not the one in the address", () => {
    expect(parseView(JSON.stringify(view({ number: 13 })))).toBeNull();
    expect(parseView(JSON.stringify(view({ number: 12_345_678_901 })))).toBeNull();
  });
});

describe("parseConversation", () => {
  const candidates = (nodes: unknown[]) =>
    JSON.stringify({ data: { repository: { pullRequests: { nodes } } } });

  it("lists the pull requests of the head with who may have opened them", () => {
    const answer = parseConversation(
      candidates([
        { number: 41, state: "OPEN", authorAssociation: "NONE" },
        { number: 40, state: "OPEN", authorAssociation: "OWNER", isCrossRepository: false },
        { number: 39, state: "MERGED", authorAssociation: "COLLABORATOR", isCrossRepository: true },
        { number: 38, state: "CLOSED", authorAssociation: "CONTRIBUTOR" },
        { number: 37, state: "OPEN", authorAssociation: "MEMBER" },
        { number: 36, state: "OPEN" },
        { state: "OPEN", authorAssociation: "OWNER" },
      ]),
      false,
    );
    expect(answer?.detail).toBeNull();
    expect(answer?.candidates).toEqual([
      { number: 41, open: true, trusted: false, here: false },
      { number: 40, open: true, trusted: true, here: true },
      { number: 39, open: false, trusted: true, here: false },
      { number: 38, open: false, trusted: false, here: false },
      { number: 37, open: true, trusted: true, here: false },
      { number: 36, open: true, trusted: false, here: false },
    ]);
  });

  it("never trusts a pull request with no author when the viewer is unknown", () => {
    const answer = parseConversation(
      JSON.stringify({
        data: {
          viewer: null,
          repository: {
            pullRequests: {
              nodes: [
                { number: 41, state: "OPEN", authorAssociation: "NONE", author: null },
                { number: 40, state: "OPEN", authorAssociation: "NONE", author: { login: null } },
              ],
            },
          },
        },
      }),
      false,
    );
    expect(answer?.candidates.map(({ trusted }) => trusted)).toEqual([false, false]);
  });

  it("reads the newest commits and GitHub's count, and none when they are absent", () => {
    const nodes = [
      { commit: { oid: "c".repeat(40), messageHeadline: "older" } },
      { commit: { oid: "bad", messageHeadline: "dropped" } },
      { commit: { oid: head, messageHeadline: "newest" } },
    ];
    const text = JSON.stringify({
      data: { repository: { pullRequest: { commits: { totalCount: 161, nodes } } } },
    });
    expect(parseConversation(text, false)?.commits).toEqual({
      commits: [
        { oid: "ccccccc", headline: "older" },
        { oid: "aaaaaaa", headline: "newest" },
      ],
      moreCommits: 158,
    });
    expect(parseConversation(candidates([]), false)?.commits).toBeNull();
  });

  it("says when gh's list of commits stops before the head", () => {
    const listed = (count: number, last: string) =>
      Array.from({ length: count }, (_, index) => ({
        oid: index === count - 1 ? last : "b".repeat(40),
        headline: "x",
      }));
    expect(read(view({ commits: listed(100, "c".repeat(40)) }))?.commitsCut).toBe(true);
    expect(read(view({ commits: listed(100, head) }))?.commitsCut).toBe(false);
    expect(read(view({ commits: listed(99, "c".repeat(40)) }))?.commitsCut).toBe(false);
  });

  it("reads the detail only when it was asked for", () => {
    const text = JSON.stringify({
      data: { repository: { pullRequests: { nodes: [] }, pullRequest: full() } },
    });
    expect(parseConversation(text, false)?.detail).toBeNull();
    expect(parseConversation(text, true)?.detail).toMatchObject({ kind: "read" });
  });
});

describe("parseThreads", () => {
  it("counts the open threads", () => {
    const detail = parseThreads(threadsAnswer(full()));
    expect(detail).toEqual({ kind: "read", openThreads: 2, moreThreads: 0 });
    expect(pullRequestAnswer.safeParse({ ...read(view())?.found, detail }).success).toBe(true);
  });

  it("counts a thread with no resolved flag as open and the ones past the first page as more", () => {
    const nodes = [{ isResolved: "yes" }, {}, { isResolved: true }, 5];
    expect(parseThreads(threadsAnswer({ reviewThreads: { totalCount: 240, nodes } }))).toEqual({
      kind: "read",
      openThreads: 2,
      moreThreads: 237,
    });
    const many = Array.from({ length: 130 }, () => ({ isResolved: false }));
    expect(
      parseThreads(threadsAnswer({ reviewThreads: { totalCount: 130, nodes: many } })),
    ).toEqual({ kind: "read", openThreads: pullRequestLimits.threads, moreThreads: 30 });
  });

  it("answers no threads for a pull request node without them and null without the node", () => {
    expect(parseThreads(threadsAnswer({}))).toEqual({
      kind: "read",
      openThreads: 0,
      moreThreads: 0,
    });
    expect(parseThreads(threadsAnswer(null))).toBeNull();
  });
});

const prefix = (text: string) => `2026-01-01T00:00:0${text}`;

describe("failedLines", () => {
  it("reduces a log to its error lines and leaves out the bare exit code", () => {
    const log = [
      prefix("0.1234567Z starting"),
      prefix("1.0000000Z ##[error]AssertionError: expected 2 to be 3"),
      prefix("2.0000000Z more output"),
      prefix("3.0000000Z ##[error]Process completed with exit code 1."),
    ].join("\n");
    expect(failedLines(log)).toEqual({
      lines: ["AssertionError: expected 2 to be 3"],
      more: false,
    });
  });

  it("shows the lines that led to a bare exit code, not the cleanup after it", () => {
    const log = [
      `\uFEFF${prefix("0.0000000Z Current runner version: 2.330.0")}`,
      ...Array.from({ length: 50 }, (_, index) => prefix(`1.0000000Z setup ${String(index)}`)),
      prefix("2.0000000Z ##[group]Run npm run journeys"),
      prefix("2.1000000Z npm run journeys"),
      prefix("2.2000000Z ##[endgroup]"),
      prefix("3.0000000Z pass launch"),
      prefix("4.0000000Z fail projects locator.click: Timeout 30000ms exceeded."),
      prefix("5.0000000Z pass quit"),
      prefix("6.0000000Z ##[error]Process completed with exit code 1."),
      prefix("7.0000000Z ##[group]Run actions/upload-artifact@v4"),
      ...Array.from({ length: 50 }, (_, index) => prefix(`8.0000000Z cleanup ${String(index)}`)),
    ].join("\n");
    const { lines, more } = failedLines(log);
    expect(lines).toHaveLength(pullRequestLimits.logLines);
    expect(lines.at(-1)).toBe("Process completed with exit code 1.");
    expect(lines.at(-3)).toBe("fail projects locator.click: Timeout 30000ms exceeded.");
    expect(lines.some((line) => line.startsWith("cleanup"))).toBe(false);
    expect(lines.slice(-6, -4)).toEqual(["Run npm run journeys", "npm run journeys"]);
    expect(more).toBe(true);
  });

  it("falls back to the last 40 lines", () => {
    const log = Array.from({ length: 60 }, (_, index) =>
      prefix(`0.0000000Z line ${String(index)}`),
    ).join("\n");
    const { lines, more } = failedLines(log);
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe("line 20");
    expect(lines[39]).toBe("line 59");
    expect(more).toBe(true);
    expect(failedLines("one\ntwo\n").lines).toEqual(["one", "two"]);
    expect(failedLines("")).toEqual({ lines: [], more: false });
  });

  it("strips the timestamp and terminal escapes and keeps a line's own tabs as spaces", () => {
    const log = [
      `\uFEFF2026-01-01T00:00:00.1234567Z \u001b[31;1mred\u001b[0m text`,
      `no prefix \u001b]0;title\u0007kept`,
      "2026-01-01T00:00:00Z a\tb\tc\td",
    ].join("\n");
    expect(failedLines(log).lines).toEqual(["red text", "no prefix kept", "a b c d"]);
  });

  it("hides characters that draw as nothing", () => {
    expect(failedLines("a\u202Eb").lines[0]).toContain("[U+202E]");
  });

  it("cuts a long line and a long error list and says so", () => {
    const long = failedLines(`##[error]${"x".repeat(500)}`);
    expect(long.lines[0]).toHaveLength(pullRequestLimits.logLineChars);
    expect(long.more).toBe(true);
    const errors = Array.from({ length: 45 }, (_, index) => `##[error]e${String(index)}`).join(
      "\n",
    );
    expect(failedLines(errors)).toMatchObject({ more: true });
    expect(failedLines(errors).lines).toHaveLength(40);
  });
});
