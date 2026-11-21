import { cleanBase } from "../changes/prompt-requests.ts";

const digits = /^[0-9]{1,20}$/;
const threadAddress =
  /^https:\/\/[A-Za-z0-9.-]{1,253}\/[A-Za-z0-9_-]{1,39}\/[A-Za-z0-9._-]{1,100}\/pull\/[0-9]{1,10}#discussion_r[0-9]{1,20}$/;

export function openRequest(): string {
  return "Open a pull request for this branch.";
}

export function checkRequest(number: number, run: string | null, job: string | null): string {
  const head = `A check failed on pull request #${String(number)}.`;
  if (run === null || job === null || !digits.test(run) || !digits.test(job)) {
    return `${head} Run gh pr checks ${String(number)} to see which one and fix it.`;
  }
  return `${head} Read the log of job ${job} in run ${run} with gh and fix what it reports.`;
}

export function threadRequest(number: number, url: string | null): string {
  if (url === null || !threadAddress.test(url)) {
    return `Review threads on pull request #${String(number)} are unresolved. Read them with gh and address them.`;
  }
  return `A review thread on pull request #${String(number)} needs an answer in the code. Read it with gh at ${url} and address it.`;
}

export function baseRequest(base: string | null): string {
  return `Fetch ${cleanBase(base)} from the remote so Satellite can show this pull request's files.`;
}
