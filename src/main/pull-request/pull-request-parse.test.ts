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

function parseThreads(text: string, at: PullRequestPlace) {
  return parseConversation(text, at, true)?.detail ?? null;
}

function view(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 12,
    url: address,
    title: "Add the widget",
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature/widget",
    headRefOid: head,
    isCrossRepository: false,
    body: "A description.",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "REVIEW_REQUIRED",
    changedFiles: 3,
    reviews: [
      {
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

const read = (value: unknown, localHead: string | null = null) =>
  parseView(JSON.stringify(value), localHead);

describe("parseView", () => {
  it("reads a full answer", () => {
    const answer = read(view(), head);
    expect(answer?.place).toEqual(place);
    expect(answer?.headOid).toBe(head);
    expect(answer?.found).toEqual({
      kind: "found",
      number: 12,
      url: address,
      host: "github.com",
      title: "Add the widget",
      state: "open",
      base: "main",
      head: "feature/widget",
      crossRepository: false,
      mergeable: "mergeable",
      mergeState: "clean",
      review: "review-required",
      counts: { failed: 0, pending: 1, passed: 1, total: 2 },
      needs: [],
      atHead: true,
      body: "A description.",
      bodyCut: false,
      changedFiles: 3,
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
      title: "",
      state: "open",
      base: null,
      head: null,
      mergeable: "unknown",
      mergeState: "unknown",
      review: "none",
      atHead: null,
      changedFiles: null,
      commits: [],
      checks: [],
      needs: [],
    });
  });

  it("degrades a field of the wrong type to its empty value", () => {
    const answer = read(
      view({
        title: 5,
        body: [],
        isDraft: "yes",
        changedFiles: "3",
        checks: "x",
        commits: { a: 1 },
        reviews: 7,
      }),
    );
    expect(answer?.found).toMatchObject({
      title: "",
      body: "",
      state: "open",
      changedFiles: null,
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
      expect(parseView(text, null), text).toBeNull();
      expect(parseThreads(text, place), text).toBeNull();
      expect(failedLines(text).lines).toBeDefined();
    }
  });

  it("cuts a long body, title, headline and list and counts the rest", () => {
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
    const found = read(
      view({ title: "t".repeat(400), body: "b".repeat(30_000), checks, commits }),
    )?.found;
    expect(found?.title).toHaveLength(pullRequestLimits.titleChars);
    expect(found?.body).toHaveLength(pullRequestLimits.bodyChars);
    expect(found?.bodyCut).toBe(true);
    expect(found?.checks).toHaveLength(100);
    expect(found?.moreChecks).toBe(30);
    expect(found?.counts).toEqual({ failed: 1, pending: 0, passed: 129, total: 130 });
    expect(found?.needs).toEqual(["checks"]);
    expect(found?.commits).toHaveLength(100);
    expect(found?.moreCommits).toBe(5);
    expect(found?.commits[0]?.headline).toHaveLength(256);
  });

  it("does not split a character when it cuts", () => {
    const found = read(view({ title: `${"t".repeat(255)}😀` }))?.found;
    expect(found?.title).toBe("t".repeat(255));
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

  it("reads atHead against the local head and a branch name that is not one as null", () => {
    expect(read(view(), "d".repeat(40))?.found.atHead).toBe(false);
    expect(read(view({ headRefOid: "short" }), head)?.found.atHead).toBeNull();
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

const comment = (changes: Record<string, unknown> = {}) => ({
  url: "https://github.com/example-org/verify-repo/pull/12#issuecomment-1",
  createdAt: "2026-01-01T00:00:00Z",
  body: "Looks fine.",
  isMinimized: false,
  author: { login: "ada-example" },
  ...changes,
});
const threadsAnswer = (pullRequest: unknown) =>
  JSON.stringify({ data: { repository: { pullRequest } } });
const discussion = "https://github.com/example-org/verify-repo/pull/12#discussion_r77";
const thread = (changes: Record<string, unknown> = {}) => ({
  isResolved: false,
  isOutdated: false,
  path: "src/app.ts",
  line: 14,
  diffSide: "RIGHT",
  comments: {
    totalCount: 1,
    nodes: [comment({ url: discussion, body: "Rename this." })],
  },
  ...changes,
});
const full = () => ({
  reviews: {
    totalCount: 2,
    nodes: [
      {
        url: "https://github.com/example-org/verify-repo/pull/12#pullrequestreview-5",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-01-01T00:00:00Z",
        body: "Please fix.",
        author: { login: "ada-example" },
      },
      { url: null, state: "APPROVED", submittedAt: "2026-01-02T00:00:00Z", body: "", author: null },
    ],
  },
  comments: { totalCount: 1, nodes: [comment()] },
  reviewThreads: { totalCount: 1, nodes: [thread()] },
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
        null,
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
      null,
    )?.found;
    expect(credentials?.checks[0]?.url).toBeNull();
  });

  it("refuses a number that is not the one in the address", () => {
    expect(parseView(JSON.stringify(view({ number: 13 })), null)).toBeNull();
    expect(parseView(JSON.stringify(view({ number: 12_345_678_901 })), null)).toBeNull();
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
      place,
      false,
    );
    expect(answer?.detail).toBeNull();
    expect(answer?.candidates).toEqual([
      { number: 41, open: true, writer: false, here: false },
      { number: 40, open: true, writer: true, here: true },
      { number: 39, open: false, writer: true, here: false },
      { number: 38, open: false, writer: false, here: false },
      { number: 37, open: true, writer: true, here: false },
      { number: 36, open: true, writer: false, here: false },
    ]);
  });

  it("reads the detail only when it was asked for", () => {
    const text = JSON.stringify({
      data: { repository: { pullRequests: { nodes: [] }, pullRequest: full() } },
    });
    expect(parseConversation(text, place, false)?.detail).toBeNull();
    expect(parseConversation(text, place, true)?.detail).toMatchObject({ kind: "read" });
  });
});

describe("parseThreads", () => {
  it("reads the conversation", () => {
    const detail = parseThreads(threadsAnswer(full()), place);
    expect(detail?.kind).toBe("read");
    expect(detail?.reviews.map(({ state, author }) => [state, author])).toEqual([
      ["changes-requested", "ada-example"],
      ["approved", null],
    ]);
    expect(detail?.comments[0]).toMatchObject({
      author: "ada-example",
      body: "Looks fine.",
      hidden: false,
    });
    expect(detail?.threads[0]).toMatchObject({
      resolved: false,
      outdated: false,
      path: "src/app.ts",
      line: 14,
      side: "right",
      url: discussion,
      moreComments: 0,
    });
    expect(
      pullRequestAnswer.safeParse({
        ...read(view())?.found,
        detail,
      }).success,
    ).toBe(true);
  });

  it("reads threads with a null line as listed and not placed", () => {
    const detail = parseThreads(
      threadsAnswer({
        ...full(),
        reviewThreads: {
          totalCount: 2,
          nodes: [
            thread({ line: null, isOutdated: true }),
            thread({ path: null, line: 0, diffSide: null }),
          ],
        },
      }),
      place,
    );
    expect(detail?.threads).toHaveLength(2);
    expect(detail?.threads[0]).toMatchObject({ line: null, outdated: true, path: "src/app.ts" });
    expect(detail?.threads[1]).toMatchObject({ line: null, path: null, side: null });
  });

  it("refuses a path that is not a change path", () => {
    for (const path of ["/etc/passwd", "../x", "a/../b", "C:\\x"]) {
      const detail = parseThreads(
        threadsAnswer({ ...full(), reviewThreads: { totalCount: 1, nodes: [thread({ path })] } }),
        place,
      );
      expect(detail?.threads[0]?.path, path).toBeNull();
    }
  });

  it("keeps a thread address only in the rebuilt shape", () => {
    for (const url of [
      "https://evil.example.com/example-org/verify-repo/pull/12#discussion_r77",
      "https://github.com/example-org/verify-repo/pull/13#discussion_r77",
      "https://github.com/example-org/verify-repo/pull/12#discussion_r7x",
      "https://github.com/example-org/verify-repo/pull/12#discussion_r",
      "https://github.com/example-org/verify-repo/pull/12",
      "javascript:alert(1)",
    ]) {
      const detail = parseThreads(
        threadsAnswer({
          ...full(),
          reviewThreads: {
            totalCount: 1,
            nodes: [thread({ comments: { totalCount: 1, nodes: [comment({ url })] } })],
          },
        }),
        place,
      );
      expect(detail?.threads[0]?.url, url).toBeNull();
    }
  });

  it("drops a commented review with no body", () => {
    const detail = parseThreads(
      threadsAnswer({
        ...full(),
        reviews: {
          totalCount: 3,
          nodes: [
            { state: "COMMENTED", body: "", author: { login: "ada-example" } },
            { state: "COMMENTED", body: "  \n", author: { login: "ada-example" } },
            { state: "COMMENTED", body: "A note.", author: { login: "ada-example" } },
            { state: "WEIRD", body: "x", author: { login: "ada-example" } },
          ],
        },
      }),
      place,
    );
    expect(detail?.reviews.map(({ body }) => body)).toEqual(["A note."]);
  });

  it("empty commented reviews do not crowd real reviews out", () => {
    const empties = Array.from({ length: 60 }, () => ({ state: "COMMENTED", body: "" }));
    const detail = parseThreads(
      threadsAnswer({
        ...full(),
        reviews: {
          totalCount: 61,
          nodes: [{ state: "CHANGES_REQUESTED", body: "Please fix." }, ...empties],
        },
      }),
      place,
    );
    expect(detail?.reviews.map(({ state }) => state)).toEqual(["changes-requested"]);
    expect(detail?.moreReviews).toBe(0);
  });

  it("holds the whole conversation to its character budget and counts what it cut", () => {
    const long = (index: number) => comment({ body: String(index % 10).repeat(20_000) });
    const many = (count: number) => Array.from({ length: count }, (_, index) => long(index));
    const detail = parseThreads(
      threadsAnswer({
        reviews: { totalCount: 0, nodes: [] },
        comments: { totalCount: 50, nodes: many(50) },
        reviewThreads: {
          totalCount: 100,
          nodes: Array.from({ length: 100 }, () =>
            thread({ comments: { totalCount: 20, nodes: many(20) } }),
          ),
        },
      }),
      place,
    );
    const bodies = [
      ...(detail?.comments ?? []),
      ...(detail?.threads.flatMap(({ comments }) => comments) ?? []),
    ];
    const total = bodies.reduce((sum, { body }) => sum + body.length, 0);
    expect(total).toBeLessThanOrEqual(pullRequestLimits.detailChars);
    expect(total).toBe(pullRequestLimits.detailChars);
    expect(detail?.threads[0]?.comments).toHaveLength(20);
    expect(detail?.threads[0]?.moreComments).toBe(0);
    expect(detail?.threads[1]?.comments).toHaveLength(0);
    expect(detail?.threads[1]?.moreComments).toBe(20);
    expect(detail?.comments).toHaveLength(0);
    expect(detail?.moreComments).toBe(50);
    expect(JSON.stringify(detail).length).toBeLessThan(pullRequestLimits.detailChars + 200_000);
    const checked = pullRequestAnswer.safeParse({
      ...read(view())?.found,
      detail,
    });
    expect(checked.success).toBe(true);
  });

  it("hides a minimized comment", () => {
    const detail = parseThreads(
      threadsAnswer({
        ...full(),
        comments: { totalCount: 1, nodes: [comment({ isMinimized: true, body: "spam" })] },
      }),
      place,
    );
    expect(detail?.comments[0]).toMatchObject({ hidden: true, body: "", bodyCut: false });
  });

  it("hides a minimised review and a minimised thread comment with their reason", () => {
    const detail = parseThreads(
      threadsAnswer({
        ...full(),
        reviews: {
          totalCount: 1,
          nodes: [
            { state: "COMMENTED", body: "buy now", isMinimized: true, minimizedReason: "SPAM" },
          ],
        },
        comments: {
          totalCount: 2,
          nodes: [
            comment({ isMinimized: true, minimizedReason: "OFF_TOPIC", body: "x" }),
            comment({ isMinimized: true, minimizedReason: "<b>made up</b>", body: "y" }),
          ],
        },
        reviewThreads: {
          totalCount: 1,
          nodes: [
            thread({
              comments: {
                totalCount: 1,
                nodes: [comment({ isMinimized: true, minimizedReason: "ABUSE", body: "z" })],
              },
            }),
          ],
        },
      }),
      place,
    );
    expect(detail?.reviews[0]).toMatchObject({ hidden: true, hiddenReason: "spam", body: "" });
    expect(detail?.comments.map((one) => one.hiddenReason)).toEqual(["off-topic", null]);
    expect(detail?.threads[0]?.comments[0]).toMatchObject({
      hidden: true,
      hiddenReason: "abuse",
      body: "",
    });
  });

  it("answers null for a missing pull request node", () => {
    expect(parseThreads(threadsAnswer(null), place)).toBeNull();
    expect(parseThreads(JSON.stringify({ data: { repository: null } }), place)).toBeNull();
    expect(parseThreads(JSON.stringify({ errors: [{ message: "x" }] }), place)).toBeNull();
  });

  it("cuts a long body, list and thread and counts the rest", () => {
    const many = (count: number, make: (index: number) => unknown) =>
      Array.from({ length: count }, (_, index) => make(index));
    const detail = parseThreads(
      threadsAnswer({
        reviews: { totalCount: 80, nodes: many(50, () => ({ state: "APPROVED", body: "x" })) },
        comments: {
          totalCount: 60,
          nodes: many(55, (index) => comment({ body: index === 54 ? "b".repeat(30_000) : "x" })),
        },
        reviewThreads: {
          totalCount: 150,
          nodes: many(120, () =>
            thread({ comments: { totalCount: 30, nodes: many(25, () => comment()) } }),
          ),
        },
      }),
      place,
    );
    expect(detail?.reviews).toHaveLength(50);
    expect(detail?.moreReviews).toBe(30);
    expect(detail?.comments).toHaveLength(50);
    expect(detail?.moreComments).toBe(10);
    expect(detail?.comments[49]).toMatchObject({ bodyCut: true });
    expect(detail?.comments[49]?.body).toHaveLength(pullRequestLimits.bodyChars);
    expect(detail?.threads).toHaveLength(100);
    expect(detail?.moreThreads).toBe(50);
    expect(detail?.threads[0]?.comments).toHaveLength(20);
    expect(detail?.threads[0]?.moreComments).toBe(10);
  });

  it("keeps the normalised address and drops one with user info or another host", () => {
    const at = (url: string) =>
      parseThreads(
        threadsAnswer({ ...full(), comments: { totalCount: 1, nodes: [comment({ url })] } }),
        place,
      )?.comments[0]?.url;
    expect(at("HTTPS://GitHub.com/example-org/verify-repo/pull/12#issuecomment-1")).toBe(
      "https://github.com/example-org/verify-repo/pull/12#issuecomment-1",
    );
    expect(at("https://github.com/example-org/verify-repo/pull/12#a\u202Eb")).toBe(
      "https://github.com/example-org/verify-repo/pull/12#a%E2%80%AEb",
    );
    expect(at("https://user@github.com/example-org/verify-repo/pull/12")).toBeNull();
    expect(at("https://evil.example.invalid/example-org/verify-repo/pull/12")).toBeNull();
    expect(at("https://github.com.evil.example.invalid/x")).toBeNull();
  });

  it("drops an address that is not https", () => {
    const detail = parseThreads(
      threadsAnswer({
        ...full(),
        comments: { totalCount: 1, nodes: [comment({ url: "javascript:alert(1)" })] },
      }),
      place,
    );
    expect(detail?.comments[0]?.url).toBeNull();
  });
});

const prefix = (text: string) => `2026-01-01T00:00:0${text}`;

describe("failedLines", () => {
  it("reduces a log to its error lines", () => {
    const log = [
      prefix("0.1234567Z starting"),
      prefix("1.0000000Z ##[error]Process completed with exit code 1."),
      prefix("2.0000000Z more output"),
      prefix("3.0000000Z ##[error]Second failure"),
    ].join("\n");
    expect(failedLines(log)).toEqual({
      lines: ["Process completed with exit code 1.", "Second failure"],
      more: false,
    });
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
