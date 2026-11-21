import type { PullRequestDetail } from "../../shared/bridge-contract.ts";

type Read = Extract<PullRequestDetail, { kind: "read" }>;

export interface ThreadMark {
  line: number;
  threads: number[];
  unresolved: boolean;
}

export interface ThreadPlaces {
  marks: ThreadMark[];
  listed: number[];
}

export function threadPlaces(detail: Read, path: string, onLines = true): ThreadPlaces {
  const lines = new Map<number, ThreadMark>();
  const listed: number[] = [];
  detail.threads.forEach((thread, index) => {
    if (thread.path !== path) return;
    const placed =
      onLines && !thread.outdated && thread.side === "right" && thread.line !== null
        ? thread.line
        : null;
    if (placed === null) {
      listed.push(index);
      return;
    }
    const mark = lines.get(placed) ?? { line: placed, threads: [], unresolved: false };
    mark.threads.push(index);
    mark.unresolved ||= !thread.resolved;
    lines.set(placed, mark);
  });
  const open = (index: number) => (detail.threads[index]?.resolved === false ? 0 : 1);
  const unresolvedFirst = (left: number, right: number) => open(left) - open(right) || left - right;
  const marks = [...lines.values()]
    .sort((left, right) => left.line - right.line)
    .map((mark) => ({ ...mark, threads: mark.threads.sort(unresolvedFirst) }));
  return { marks, listed: listed.sort(unresolvedFirst) };
}
