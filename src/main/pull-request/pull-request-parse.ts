import { z } from "zod";
import {
  pullRequestLimits,
  type PullRequestDetail,
  type PullRequestFound,
} from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { isBranchName } from "../../shared/workspace-name.ts";
import { checksOf, countsOf } from "./check-result.ts";
import { cutText } from "./cut-text.ts";
import { placeOf, type PullRequestPlace } from "./gh-arguments.ts";
import {
  isOwnerMemberOrCollaborator,
  needsOf,
  reviewersOf,
  type ReviewFact,
} from "./pull-request-needs.ts";

type Found = Omit<PullRequestFound, "detail">;
type ReadDetail = Extract<PullRequestDetail, { kind: "read" }>;
type Commit = Found["commits"][number];

const looseText = z.string().nullish().catch(undefined);
const looseCount = z.number().nullish().catch(undefined);
const looseFlag = z.boolean().nullish().catch(undefined);
const looseList = z.array(z.unknown()).nullish().catch(undefined);
const looseNode = <T extends z.ZodType>(shape: T) => shape.nullish().catch(undefined);
const viewShape = z.object({
  number: looseCount,
  url: looseText,
  state: looseText,
  isDraft: looseFlag,
  baseRefName: looseText,
  headRefName: looseText,
  headRefOid: looseText,
  isCrossRepository: looseFlag,
  mergeable: looseText,
  mergeStateStatus: looseText,
  reviewDecision: looseText,
  reviews: looseList,
  checks: looseList,
  commits: looseList,
});
const reviewFactShape = z.object({
  id: looseText,
  state: looseText,
  commit: looseText,
  login: looseText,
  association: looseText,
  at: looseText,
});
const commitShape = z.object({ oid: looseText, headline: looseText });
const pullRequestCommit = z.object({
  commit: looseNode(z.object({ oid: looseText, messageHeadline: looseText })),
});
const author = looseNode(z.object({ login: looseText }));
const connection = z.object({
  totalCount: looseCount,
  nodes: looseList,
});
const threadNode = z.object({ isResolved: looseFlag });
const candidateNode = z.object({
  number: looseCount,
  state: looseText,
  authorAssociation: looseText,
  author,
  isCrossRepository: looseFlag,
});
const threadsShape = z.object({
  data: looseNode(
    z.object({
      viewer: author,
      repository: looseNode(
        z.object({
          pullRequests: looseNode(z.object({ nodes: looseList })),
          pullRequest: looseNode(
            z.object({
              commits: looseNode(connection),
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
const escape = String.fromCharCode(0x1b);
const bell = String.fromCharCode(0x07);
const terminalEscape = new RegExp(
  `${escape}\\[[0-9;?]*[ -/]*[@-~]|${escape}\\][^${bell}${escape}]*(?:${bell}|${escape}\\\\)`,
  "g",
);
const timestamp = /^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
const errorMarker = "##[error]";
const groupMarker = "##[group]";
const groupEnd = "##[endgroup]";
const exitLine = /^Process completed with exit code -?\d+\.$/;

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

function lastOf<T>(items: T[], limit: number): T[] {
  return items.slice(-limit);
}

function reviewFactsOf(list: readonly unknown[] | null | undefined): ReviewFact[] {
  return each(list, reviewFactShape).map((review) => ({
    id: review.id ?? null,
    login: review.login ?? null,
    state: review.state ?? "",
    commit: review.commit ?? null,
    association: review.association ?? null,
    at: review.at ?? null,
  }));
}

function commitOf(oid: string | null | undefined, headline: string | null | undefined): Commit[] {
  return oid !== undefined && oid !== null && oidPattern.test(oid)
    ? [{ oid: oid.slice(0, 7), headline: cutText(headline ?? "", 256).text }]
    : [];
}

function stateOf(
  state: string | null | undefined,
  draft: boolean | null | undefined,
): Found["state"] {
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return state === "OPEN" && draft === true ? "draft" : "open";
}

export function parseView(stdout: string): {
  place: PullRequestPlace;
  found: Found;
  headOid: string | null;
  commitsCut: boolean;
} | null {
  const parsed = viewShape.safeParse(parseJson(stdout));
  if (!parsed.success) return null;
  const view = parsed.data;
  const number = view.number;
  if (number === undefined || number === null || !Number.isInteger(number) || number < 1)
    return null;
  const place = placeOf(view.url ?? "");
  if (place?.number !== number) return null;
  const headOid =
    view.headRefOid !== undefined && view.headRefOid !== null && oidPattern.test(view.headRefOid)
      ? view.headRefOid
      : null;
  const state = stateOf(view.state, view.isDraft);
  const checks = checksOf(view.checks, place);
  const counts = countsOf(checks);
  const mergeable = mergeableOf.parse(dashed(view.mergeable));
  const reviewers = reviewersOf(reviewFactsOf(view.reviews), headOid);
  const listed = each(view.commits, commitShape);
  const commits = listed.flatMap((commit) => commitOf(commit.oid, commit.headline));
  const commitsCut =
    listed.length >= pullRequestLimits.commits && listed.at(-1)?.oid !== view.headRefOid;
  const found: Found = {
    kind: "found",
    number,
    url: view.url ?? "",
    host: place.host,
    state,
    base: branchOf(view.baseRefName),
    head: branchOf(view.headRefName),
    crossRepository: view.isCrossRepository === true,
    mergeable,
    mergeState: mergeStateOf.parse(dashed(view.mergeStateStatus)),
    review: decisionOf.parse(dashed(view.reviewDecision)),
    reviewers: reviewers.slice(0, pullRequestLimits.reviewers),
    counts,
    needs: needsOf({ state, counts, mergeable, reviewers }),
    commits: commits.slice(0, pullRequestLimits.commits),
    moreCommits: restOf(commits.length, pullRequestLimits.commits),
    checks: checks.slice(0, pullRequestLimits.checks),
    moreChecks: restOf(checks.length, pullRequestLimits.checks),
  };
  return { place, found, headOid, commitsCut };
}

export interface Candidate {
  number: number;
  open: boolean;
  trusted: boolean;
  here: boolean;
}

export interface Conversation {
  candidates: Candidate[];
  commits: Pick<Found, "commits" | "moreCommits"> | null;
  detail: ReadDetail | null;
}

function newestCommits(
  list: z.output<typeof connection> | null | undefined,
): Conversation["commits"] {
  if (list?.nodes === undefined || list.nodes === null) return null;
  const nodes = lastOf(each(list.nodes, pullRequestCommit), pullRequestLimits.commits);
  return {
    commits: nodes.flatMap(({ commit }) => commitOf(commit?.oid, commit?.messageHeadline)),
    moreCommits: restOf(list.totalCount, nodes.length),
  };
}

function viewerOf(login: string | null | undefined): string | null {
  return typeof login === "string" && login !== "" ? login : null;
}

function candidatesOf(
  list: readonly unknown[] | null | undefined,
  viewer: string | null,
): Candidate[] {
  const own = (login: string | null | undefined) => viewer !== null && login === viewer;
  return each(list, candidateNode).flatMap((node) =>
    typeof node.number === "number" && Number.isInteger(node.number)
      ? [
          {
            number: node.number,
            open: node.state === "OPEN",
            trusted: isOwnerMemberOrCollaborator(node.authorAssociation) || own(node.author?.login),
            here: node.isCrossRepository === false,
          },
        ]
      : [],
  );
}

function detailOf(list: z.output<typeof connection> | null | undefined): ReadDetail {
  const threads = each(list?.nodes, threadNode).slice(0, pullRequestLimits.threads);
  return {
    kind: "read",
    openThreads: threads.filter((thread) => thread.isResolved !== true).length,
    moreThreads: restOf(list?.totalCount, threads.length),
  };
}

export function parseConversation(stdout: string, detail: boolean): Conversation | null {
  const parsed = threadsShape.safeParse(parseJson(stdout));
  const data = parsed.success ? parsed.data.data : undefined;
  const repository = data?.repository;
  if (repository === undefined || repository === null) return null;
  const pullRequest = repository.pullRequest;
  return {
    candidates: candidatesOf(repository.pullRequests?.nodes, viewerOf(data?.viewer?.login)),
    commits: newestCommits(pullRequest?.commits),
    detail:
      detail && pullRequest !== undefined && pullRequest !== null
        ? detailOf(pullRequest.reviewThreads)
        : null,
  };
}

function lineOf(raw: string): string {
  const text = raw.replace(terminalEscape, "").replace(timestamp, "").replaceAll("\t", " ");
  return visibleText(text.startsWith(groupMarker) ? text.slice(groupMarker.length) : text);
}

export function failedLines(stdout: string): { lines: string[]; more: boolean } {
  const lines = stdout
    .split(/\r?\n/)
    .map(lineOf)
    .filter((line) => line.trim() !== "" && line !== groupEnd);
  const marked = lines.map((line) =>
    line.includes(errorMarker) ? line.replace(errorMarker, "").trim() : null,
  );
  const told = marked.filter((text): text is string => text !== null && !exitLine.test(text));
  const exit = marked.findIndex((text) => text !== null && exitLine.test(text));
  const chosen =
    told.length > 0
      ? told
      : lines
          .slice(0, exit === -1 ? lines.length : exit + 1)
          .map((line, index) => marked[index] ?? line);
  const picked =
    told.length > 0
      ? chosen.slice(0, pullRequestLimits.logLines)
      : chosen.slice(-pullRequestLimits.logLines);
  const cuts = picked.map((line) => cutText(line, pullRequestLimits.logLineChars));
  return {
    lines: cuts.map(({ text }) => text),
    more: picked.length < chosen.length || cuts.some(({ cut }) => cut),
  };
}
