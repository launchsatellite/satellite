import { reviewId } from "../../shared/bridge-contract.ts";

const digits = /^[0-9]{1,20}$/;

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

export function reviewRequest(number: number, id: string | null): string {
  if (id === null || !reviewId.test(id)) {
    return `A review on pull request #${String(number)} asks for changes. Read the reviews with gh and address them.`;
  }
  return `Review ${id} on pull request #${String(number)} asks for changes. Read it with gh and address it.`;
}

export function threadsRequest(number: number): string {
  return `Review threads on pull request #${String(number)} are unresolved. Read them with gh and address them.`;
}
