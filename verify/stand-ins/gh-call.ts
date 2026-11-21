import { isBranchName } from "../../src/shared/workspace-name.ts";
import {
  isCheckedPlace,
  logArguments,
  threadsArguments,
  viewArguments,
} from "../../src/main/pull-request/gh-arguments.ts";

export type GhCall = "pull-request" | "threads" | "failed-log";

const jobPattern = /^[0-9]{1,20}$/;

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
  const head = prefixed(valueAfter(args, 8, "-f"), "head=");
  const number = prefixed(valueAfter(args, 10, "-F"), "number=");
  const detail = prefixed(valueAfter(args, 12, "-F"), "detail=");
  if (
    host === undefined ||
    owner === undefined ||
    repo === undefined ||
    head === undefined ||
    number === undefined ||
    detail === undefined ||
    !isBranchName(head)
  ) {
    return false;
  }
  const place = { host, owner, repo, number: Number(number) };
  return (
    isCheckedPlace(place) && sameArguments(args, threadsArguments(place, head, detail === "true"))
  );
}

function logCall(args: readonly string[]): boolean {
  const job = valueAfter(args, 2, "--job");
  const repository = valueAfter(args, 5, "-R")?.split("/");
  if (job === undefined || !jobPattern.test(job) || repository?.length !== 3) return false;
  const [host = "", owner = "", repo = ""] = repository;
  const place = { host, owner, repo, number: 1 };
  return isCheckedPlace(place) && sameArguments(args, logArguments(place, job));
}

export function callOf(args: readonly string[]): GhCall | null {
  if (sameArguments(args, viewArguments())) return "pull-request";
  const number = args[0] === "pr" && args[1] === "view" ? Number(args[2]) : Number.NaN;
  if (number >= 1 && number <= 9_999_999_999 && sameArguments(args, viewArguments(number))) {
    return "pull-request";
  }
  if (args[0] === "api" && threadsCall(args)) return "threads";
  if (args[0] === "run" && logCall(args)) return "failed-log";
  return null;
}
