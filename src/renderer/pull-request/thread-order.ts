import type { PullRequestDetail, PullRequestThread } from "../../shared/bridge-contract.ts";

type Read = Extract<PullRequestDetail, { kind: "read" }>;
type Comment = Read["comments"][number];
type Review = Read["reviews"][number];

export type ConversationItem =
  | { kind: "thread"; thread: PullRequestThread; index: number }
  | { kind: "review"; review: Review }
  | { kind: "comment"; comment: Comment };

function timeOf(moment: string | null | undefined): number {
  const time = moment === null || moment === undefined ? Number.NaN : Date.parse(moment);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function byTime<T>(timeFor: (item: T) => number): (left: T, right: T) => number {
  return (left, right) => {
    const one = timeFor(left);
    const two = timeFor(right);
    if (one === two) return 0;
    return one < two ? -1 : 1;
  };
}

function startOf(thread: PullRequestThread): number {
  return timeOf(thread.comments[0]?.at);
}

export function conversationItems(detail: Read): ConversationItem[] {
  const threads = detail.threads.map((thread, index) => ({
    kind: "thread" as const,
    thread,
    index,
  }));
  const ordered = byTime<(typeof threads)[number]>(({ thread }) => startOf(thread));
  const open = threads.filter(({ thread }) => !thread.resolved).sort(ordered);
  const closed = threads.filter(({ thread }) => thread.resolved).sort(ordered);
  const spoken: ConversationItem[] = [
    ...detail.reviews.map((review) => ({ kind: "review" as const, review })),
    ...detail.comments.map((comment) => ({ kind: "comment" as const, comment })),
  ].sort(byTime((item) => timeOf(item.kind === "review" ? item.review.at : item.comment.at)));
  return [...open, ...spoken, ...closed];
}

function charsOf(item: ConversationItem): number {
  if (item.kind === "review") return item.review.body.length;
  if (item.kind === "comment") return item.comment.body.length;
  return item.thread.comments.reduce((total, { body }) => total + body.length, 0);
}

export function drawnCount(items: readonly ConversationItem[], budget: number): number {
  let used = 0;
  for (const [index, item] of items.entries()) {
    used += charsOf(item);
    if (used > budget) return Math.max(index, 1);
  }
  return items.length;
}

export function threadOrder(detail: Read): number[] {
  return detail.threads
    .flatMap((thread, index) => (thread.resolved ? [] : [{ thread, index }]))
    .sort((left, right) => {
      const one = left.thread;
      const two = right.thread;
      if (one.path === null || two.path === null) {
        if (one.path === two.path) return left.index - right.index;
        return one.path === null ? 1 : -1;
      }
      if (one.path !== two.path) return one.path < two.path ? -1 : 1;
      const lines = (one.line ?? Number.POSITIVE_INFINITY) - (two.line ?? Number.POSITIVE_INFINITY);
      return Number.isNaN(lines) || lines === 0 ? left.index - right.index : lines;
    })
    .map(({ index }) => index);
}
