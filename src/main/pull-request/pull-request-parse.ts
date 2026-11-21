import { z } from "zod";
import {
  pullRequestLimits,
  type PullRequestDetail,
  type PullRequestFound,
} from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { isBranchName } from "../../shared/workspace-name.ts";
import { isChangePath } from "../changes/file-sides.ts";
import { checksOf, countsOf } from "./check-result.ts";
import { cutText } from "./cut-text.ts";
import { placeOf, type PullRequestPlace } from "./gh-arguments.ts";
import { needsOf, type ReviewFact } from "./pull-request-needs.ts";

type Found = Omit<PullRequestFound, "detail">;
type ReadDetail = Extract<PullRequestDetail, { kind: "read" }>;
type Comment = ReadDetail["comments"][number];
type Review = ReadDetail["reviews"][number];
type Thread = ReadDetail["threads"][number];

const looseText = z.string().nullish().catch(undefined);
const looseCount = z.number().nullish().catch(undefined);
const looseFlag = z.boolean().nullish().catch(undefined);
const looseList = z.array(z.unknown()).nullish().catch(undefined);
const looseNode = <T extends z.ZodType>(shape: T) => shape.nullish().catch(undefined);
const viewShape = z.object({
  number: looseCount,
  url: looseText,
  title: looseText,
  state: looseText,
  isDraft: looseFlag,
  baseRefName: looseText,
  headRefName: looseText,
  headRefOid: looseText,
  isCrossRepository: looseFlag,
  body: looseText,
  mergeable: looseText,
  mergeStateStatus: looseText,
  reviewDecision: looseText,
  changedFiles: looseCount,
  reviews: looseList,
  checks: looseList,
  commits: looseList,
});
const reviewFactShape = z.object({
  state: looseText,
  commit: looseText,
  login: looseText,
  at: looseText,
});
const commitShape = z.object({ oid: looseText, headline: looseText });
const author = looseNode(z.object({ login: looseText }));
const commentNode = z.object({
  url: looseText,
  state: looseText,
  body: looseText,
  createdAt: looseText,
  submittedAt: looseText,
  isMinimized: looseFlag,
  author,
});
const connection = z.object({
  totalCount: looseCount,
  nodes: looseList,
});
const threadNode = z.object({
  isResolved: looseFlag,
  isOutdated: looseFlag,
  path: looseText,
  line: looseCount,
  diffSide: looseText,
  comments: looseNode(connection),
});
const threadsShape = z.object({
  data: looseNode(
    z.object({
      repository: looseNode(
        z.object({
          pullRequest: looseNode(
            z.object({
              reviews: looseNode(connection),
              comments: looseNode(connection),
              reviewThreads: looseNode(connection),
            }),
          ),
        }),
      ),
    }),
  ),
});

const oidPattern = /^[0-9a-f]{40,64}$/;
const mergeableOf = z.enum(["mergeable", "conflicting", "unknown"]).catch("unknown");
const mergeStateOf = z
  .enum(["behind", "blocked", "clean", "dirty", "draft", "has-hooks", "unstable", "unknown"])
  .catch("unknown");
const decisionOf = z
  .enum(["approved", "changes-requested", "review-required", "none"])
  .catch("none");
const reviewStateOf = z.enum([
  "approved",
  "changes-requested",
  "commented",
  "dismissed",
  "pending",
]);
const escape = String.fromCharCode(0x1b);
const bell = String.fromCharCode(0x07);
const terminalEscape = new RegExp(
  `${escape}\\[[0-9;?]*[ -/]*[@-~]|${escape}\\][^${bell}${escape}]*(?:${bell}|${escape}\\\\)`,
  "g",
);
const timestamp = /^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
const errorMarker = "##[error]";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function each<T extends z.ZodType>(
  list: readonly unknown[] | null | undefined,
  shape: T,
): z.output<T>[] {
  return (list ?? []).flatMap((item) => {
    const parsed = shape.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function dashed(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replaceAll("_", "-");
}

function branchOf(text: string | null | undefined): string | null {
  return text !== undefined && text !== null && isBranchName(text) ? text : null;
}

function wholeCount(value: number | null | undefined): number | null {
  if (value === undefined || value === null || !Number.isInteger(value)) return null;
  return value >= 0 ? Math.min(value, 1_000_000) : null;
}

function restOf(total: number | null | undefined, kept: number): number {
  return Math.max(0, Math.min(wholeCount(total) ?? 0, 1_000_000) - kept);
}

function momentOf(text: string | null | undefined): string | null {
  return text !== undefined && text !== null && text.length <= 40 ? text : null;
}

function addressOf(text: string | null | undefined): string | null {
  if (text === undefined || text === null || text.length > pullRequestLimits.urlChars) return null;
  return URL.parse(text)?.protocol === "https:" ? text : null;
}

function loginOf(node: z.output<typeof commentNode>): string | null {
  const login = node.author?.login;
  return login === undefined || login === null || login === ""
    ? null
    : cutText(login, pullRequestLimits.nameChars).text;
}

function commentOf(node: z.output<typeof commentNode>, at: string | null | undefined): Comment {
  const hidden = node.isMinimized === true;
  const body = hidden
    ? { text: "", cut: false }
    : cutText(node.body ?? "", pullRequestLimits.bodyChars);
  return {
    author: loginOf(node),
    at: momentOf(at),
    body: body.text,
    bodyCut: body.cut,
    hidden,
    url: addressOf(node.url),
  };
}

function lastOf<T>(items: T[], limit: number): T[] {
  return items.slice(-limit);
}

interface Budget {
  left: number;
}

function withinBudget(comment: Comment, budget: Budget): Comment | null {
  if (budget.left <= 0) return null;
  const fits = comment.body.length <= budget.left;
  const body = fits ? comment.body : cutText(comment.body, budget.left).text;
  budget.left -= body.length;
  return { ...comment, body, bodyCut: comment.bodyCut || !fits };
}

function reviewsOf(
  list: z.output<typeof connection> | null | undefined,
  budget: Budget,
): { reviews: Review[]; more: number } {
  const nodes = each(list?.nodes, commentNode);
  const real = nodes.flatMap((node): { node: typeof node; state: Review["state"] }[] => {
    const state = reviewStateOf.safeParse(dashed(node.state));
    if (!state.success) return [];
    if (state.data === "commented" && (node.body ?? "").trim() === "") return [];
    return [{ node, state: state.data }];
  });
  const newest = lastOf(real, pullRequestLimits.reviews);
  const reviews = newest.flatMap(({ node, state }): Review[] => {
    const comment = withinBudget(commentOf(node, node.submittedAt), budget);
    return comment === null ? [] : [{ ...comment, state }];
  });
  const unseen = restOf(list?.totalCount, nodes.length);
  return { reviews, more: unseen + real.length - reviews.length };
}

function isDiscussion(address: string, prefix: string): boolean {
  return address.startsWith(prefix) && /^[0-9]+$/.test(address.slice(prefix.length));
}

function threadOf(
  node: z.output<typeof threadNode>,
  place: PullRequestPlace,
  budget: Budget,
): Thread {
  const nodes = each(node.comments?.nodes, commentNode).slice(0, pullRequestLimits.threadComments);
  const line = node.line;
  const side = (node.diffSide ?? "").toLowerCase();
  const discussion = `https://${place.host}/${place.owner}/${place.repo}/pull/${String(place.number)}#discussion_r`;
  const first = nodes[0]?.url;
  const comments = nodes.flatMap((comment) => {
    const kept = withinBudget(commentOf(comment, comment.createdAt), budget);
    return kept === null ? [] : [kept];
  });
  return {
    resolved: node.isResolved === true,
    outdated: node.isOutdated === true,
    path:
      node.path !== undefined && node.path !== null && isChangePath(node.path) ? node.path : null,
    line:
      line !== undefined &&
      line !== null &&
      Number.isInteger(line) &&
      line >= 1 &&
      line <= 1_000_000
        ? line
        : null,
    side: side === "left" || side === "right" ? side : null,
    url: first !== undefined && first !== null && isDiscussion(first, discussion) ? first : null,
    comments,
    moreComments: restOf(node.comments?.totalCount, nodes.length) + nodes.length - comments.length,
  };
}

function reviewFactsOf(list: readonly unknown[] | null | undefined): ReviewFact[] {
  return each(list, reviewFactShape).map((review) => ({
    login: review.login ?? null,
    state: review.state ?? "",
    commit: review.commit ?? null,
    at: review.at ?? null,
  }));
}

function stateOf(
  state: string | null | undefined,
  draft: boolean | null | undefined,
): Found["state"] {
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return state === "OPEN" && draft === true ? "draft" : "open";
}

export function parseView(
  stdout: string,
  localHead: string | null,
): { place: PullRequestPlace; found: Found; headOid: string | null } | null {
  const parsed = viewShape.safeParse(parseJson(stdout));
  if (!parsed.success) return null;
  const view = parsed.data;
  const number = view.number;
  if (number === undefined || number === null || !Number.isInteger(number) || number < 1)
    return null;
  const place = placeOf(view.url ?? "");
  if (place === null) return null;
  const headOid =
    view.headRefOid !== undefined && view.headRefOid !== null && oidPattern.test(view.headRefOid)
      ? view.headRefOid
      : null;
  const state = stateOf(view.state, view.isDraft);
  const checks = checksOf(view.checks, place);
  const counts = countsOf(checks);
  const body = cutText(view.body ?? "", pullRequestLimits.bodyChars);
  const commits = each(view.commits, commitShape).flatMap((commit) =>
    commit.oid !== undefined && commit.oid !== null && oidPattern.test(commit.oid)
      ? [{ oid: commit.oid.slice(0, 7), headline: cutText(commit.headline ?? "", 256).text }]
      : [],
  );
  const found: Found = {
    kind: "found",
    number,
    url: view.url ?? "",
    host: place.host,
    title: cutText(view.title ?? "", pullRequestLimits.titleChars).text,
    state,
    base: branchOf(view.baseRefName),
    head: branchOf(view.headRefName),
    crossRepository: view.isCrossRepository === true,
    mergeable: mergeableOf.parse(dashed(view.mergeable)),
    mergeState: mergeStateOf.parse(dashed(view.mergeStateStatus)),
    review: decisionOf.parse(dashed(view.reviewDecision)),
    counts,
    needs: [],
    atHead: localHead === null || headOid === null ? null : localHead === headOid,
    body: body.text,
    bodyCut: body.cut,
    changedFiles: wholeCount(view.changedFiles),
    commits: commits.slice(0, pullRequestLimits.commits),
    moreCommits: restOf(commits.length, pullRequestLimits.commits),
    checks: checks.slice(0, pullRequestLimits.checks),
    moreChecks: restOf(checks.length, pullRequestLimits.checks),
  };
  found.needs = needsOf({
    state,
    counts,
    mergeable: found.mergeable,
    reviews: reviewFactsOf(view.reviews),
    headOid,
  });
  return { place, found, headOid };
}

export function parseThreads(stdout: string, place: PullRequestPlace): ReadDetail | null {
  const parsed = threadsShape.safeParse(parseJson(stdout));
  const pullRequest = parsed.success ? parsed.data.data?.repository?.pullRequest : undefined;
  if (pullRequest === undefined || pullRequest === null) return null;
  const budget = { left: pullRequestLimits.detailChars };
  const threadNodes = each(pullRequest.reviewThreads?.nodes, threadNode).slice(
    0,
    pullRequestLimits.threads,
  );
  const threads = threadNodes.map((thread) => threadOf(thread, place, budget));
  const reviews = reviewsOf(pullRequest.reviews, budget);
  const nodes = lastOf(each(pullRequest.comments?.nodes, commentNode), pullRequestLimits.comments);
  const comments = nodes.flatMap((node) => {
    const kept = withinBudget(commentOf(node, node.createdAt), budget);
    return kept === null ? [] : [kept];
  });
  return {
    kind: "read",
    reviews: reviews.reviews,
    moreReviews: reviews.more,
    comments,
    moreComments:
      restOf(pullRequest.comments?.totalCount, nodes.length) + nodes.length - comments.length,
    threads,
    moreThreads: restOf(pullRequest.reviewThreads?.totalCount, threadNodes.length),
  };
}

function lineOf(raw: string): string {
  const parts = raw.split("\t");
  const text = parts.length >= 3 ? parts.slice(2).join("\t") : raw;
  return visibleText(text.replace(terminalEscape, "").replace(timestamp, "").replaceAll("\t", " "));
}

export function failedLines(stdout: string): { lines: string[]; more: boolean } {
  const lines = stdout
    .split(/\r?\n/)
    .map(lineOf)
    .filter((line) => line.trim() !== "");
  const errors = lines.filter((line) => line.includes(errorMarker));
  const chosen =
    errors.length > 0 ? errors.map((line) => line.replace(errorMarker, "").trim()) : lines;
  const picked =
    errors.length > 0
      ? chosen.slice(0, pullRequestLimits.logLines)
      : chosen.slice(-pullRequestLimits.logLines);
  const cuts = picked.map((line) => cutText(line, pullRequestLimits.logLineChars));
  return {
    lines: cuts.map(({ text }) => text),
    more: picked.length < chosen.length || cuts.some(({ cut }) => cut),
  };
}
