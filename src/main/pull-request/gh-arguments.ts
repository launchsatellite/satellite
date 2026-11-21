import { ghHost } from "../../shared/bridge-contract.ts";

export interface PullRequestPlace {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export type GhCall = "pull-request" | "threads" | "failed-log";

export const viewFields =
  "number,url,title,state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,body,mergeable,mergeStateStatus,reviewDecision,changedFiles,reviews,statusCheckRollup,commits";
export const viewProjection =
  "{number,url,title,state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,body,mergeable,mergeStateStatus,reviewDecision,changedFiles,reviews:[.reviews[]?|{state,commit:.commit.oid,login:.author.login,at:.submittedAt}],checks:[.statusCheckRollup[]?|{name,workflow:.workflowName,status,conclusion,context,state,url:(.detailsUrl//.targetUrl),startedAt}],commits:[.commits[]?|{oid,headline:.messageHeadline}]}";
export const threadsQuery =
  "query($owner:String!,$repo:String!,$number:Int!){rateLimit{cost}repository(owner:$owner,name:$repo){pullRequest(number:$number){reviews(last:50){totalCount nodes{url state submittedAt body author{login}}}comments(last:50){totalCount nodes{url createdAt body isMinimized author{login}}}reviewThreads(first:100){totalCount nodes{isResolved isOutdated path line startLine originalLine diffSide subjectType comments(first:20){totalCount nodes{url body createdAt author{login}}}}}}}}";

const ownerPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const repoPattern = /^[A-Za-z0-9._-]{1,100}$/;
const numberPattern = /^[1-9][0-9]{0,9}$/;
const jobPattern = /^[0-9]{1,20}$/;
const addressPattern =
  /^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/pull\/([1-9][0-9]{0,9})$/;

function isCheckedPlace({ host, owner, repo, number }: PullRequestPlace): boolean {
  return (
    ghHost.test(host) &&
    !host.includes(":") &&
    ownerPattern.test(owner) &&
    repoPattern.test(repo) &&
    repo !== "." &&
    repo !== ".." &&
    Number.isSafeInteger(number) &&
    numberPattern.test(String(number))
  );
}

function sameArguments(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((arg, index) => arg === right[index]);
}

function valueAfter(args: readonly string[], index: number, name: string): string | undefined {
  const [flag, value] = [args[index], args[index + 1]];
  return flag === name && value !== undefined ? value : undefined;
}

function prefixed(value: string | undefined, prefix: string): string | undefined {
  return value?.startsWith(prefix) === true ? value.slice(prefix.length) : undefined;
}

function threadsCall(args: readonly string[]): boolean {
  const host = valueAfter(args, 2, "--hostname");
  const owner = prefixed(valueAfter(args, 4, "-f"), "owner=");
  const repo = prefixed(valueAfter(args, 6, "-f"), "repo=");
  const number = prefixed(valueAfter(args, 8, "-F"), "number=");
  if (host === undefined || owner === undefined || repo === undefined || number === undefined) {
    return false;
  }
  const place = { host, owner, repo, number: Number(number) };
  return isCheckedPlace(place) && sameArguments(args, threadsArguments(place));
}

function logCall(args: readonly string[]): boolean {
  const job = valueAfter(args, 2, "--job");
  const repository = valueAfter(args, 5, "-R")?.split("/");
  if (job === undefined || !jobPattern.test(job) || repository?.length !== 3) return false;
  const [host = "", owner = "", repo = ""] = repository;
  const place = { host, owner, repo, number: 1 };
  return isCheckedPlace(place) && sameArguments(args, logArguments(place, job));
}

export function viewArguments(): string[] {
  return ["pr", "view", "--json", viewFields, "--jq", viewProjection];
}

export function threadsArguments({ host, owner, repo, number }: PullRequestPlace): string[] {
  return [
    "api",
    "graphql",
    "--hostname",
    host,
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${repo}`,
    "-F",
    `number=${String(number)}`,
    "-f",
    `query=${threadsQuery}`,
  ];
}

export function logArguments({ host, owner, repo }: PullRequestPlace, job: string): string[] {
  return ["run", "view", "--job", job, "--log-failed", "-R", `${host}/${owner}/${repo}`];
}

export function placeOf(url: string): PullRequestPlace | null {
  const parsed = URL.parse(url);
  if (parsed?.href !== url || url.includes("?") || url.includes("#")) return null;
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.port !== "" || parsed.search !== "" || parsed.hash !== "") return null;
  const [, owner = "", repo = "", number = ""] = addressPattern.exec(parsed.pathname) ?? [];
  const place = { host: parsed.hostname, owner, repo, number: Number(number) };
  return isCheckedPlace(place) ? place : null;
}

export function callOf(args: readonly string[]): GhCall | null {
  if (sameArguments(args, viewArguments())) return "pull-request";
  if (args[0] === "api" && threadsCall(args)) return "threads";
  if (args[0] === "run" && logCall(args)) return "failed-log";
  return null;
}
