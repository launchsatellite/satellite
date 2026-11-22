import { readStatus } from "./changed-files.ts";

type Status = Awaited<ReturnType<typeof readStatus>>;
export interface PacedRead {
  status: Status;
  finishedAt: number;
  elapsedMs: number;
  answeredAt: number;
}

const paceFactor = 4;
export const keptAnswerMs = 120_000;
const pacedFolders = 512;
const reads = new Map<string, PacedRead>();

export function mayReuse(read: PacedRead | undefined, now: number): boolean {
  return read !== undefined && now - read.finishedAt < paceFactor * read.elapsedMs;
}

export function nextRead(
  last: PacedRead | undefined,
  status: Status,
  startedAt: number,
  now: number,
): PacedRead {
  const elapsedMs = now - startedAt;
  if (status !== undefined) return { status, finishedAt: now, elapsedMs, answeredAt: now };
  const kept = last?.status !== undefined && now - last.answeredAt < keptAnswerMs;
  return {
    status: kept ? last.status : undefined,
    finishedAt: now,
    elapsedMs,
    answeredAt: kept ? last.answeredAt : now,
  };
}

export async function pacedStatus(
  folder: string,
  read: (folder: string) => Promise<Status> = readStatus,
): Promise<Status> {
  const last = reads.get(folder);
  if (mayReuse(last, Date.now())) return last?.status;
  const startedAt = Date.now();
  const status = await read(folder);
  const next = nextRead(reads.get(folder), status, startedAt, Date.now());
  if (!reads.has(folder) && reads.size >= pacedFolders) reads.clear();
  reads.set(folder, next);
  return next.status;
}
