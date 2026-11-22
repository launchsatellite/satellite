import { gitReadMs, readGit, runGit } from "./git-command.ts";

export interface StatusEntry {
  code: string;
  path: string;
}

const statusArgs = [
  "status",
  "--porcelain=v1",
  "-z",
  "--untracked-files=all",
  "--ignore-submodules=all",
  "--no-renames",
];

export function parseStatus(stdout: string): StatusEntry[] {
  const entries: StatusEntry[] = [];
  const fields = stdout.split("\0");
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    if (field.length < 4 || field[2] !== " ") continue;
    const code = field.slice(0, 2);
    entries.push({ code, path: field.slice(3) });
    if (/[RC]/.test(code)) index += 1;
  }
  return entries;
}

export async function readStatus(
  folder: string,
): Promise<{ entries: StatusEntry[]; raw: string } | undefined> {
  const run = await runGit(folder, statusArgs, gitReadMs, undefined, { filtersOf: folder });
  if (run?.exitCode !== 0) return undefined;
  return { entries: parseStatus(run.stdout), raw: run.stdout };
}

type StatusRead = Awaited<ReturnType<typeof readStatus>>;
interface PacedRead {
  answer: StatusRead;
  at: number;
  cost: number;
}

const pacedLimit = 4400;
const paced = new Map<string, PacedRead>();

function remember(folder: string, read: PacedRead): void {
  paced.delete(folder);
  paced.set(folder, read);
  const oldest = paced.keys().next().value;
  if (paced.size > pacedLimit && oldest !== undefined) paced.delete(oldest);
}

export async function pacedStatus(folder: string): Promise<StatusRead> {
  const last = paced.get(folder);
  if (last !== undefined && Date.now() - last.at < Math.max(2000, 4 * last.cost)) {
    return last.answer;
  }
  const started = Date.now();
  const run = await readGit(folder, statusArgs, gitReadMs, undefined, { filtersOf: folder });
  const ran = { at: Date.now(), cost: Date.now() - started };
  if (run === "time" || run === "stuck") {
    remember(folder, { answer: last?.answer, ...ran });
    return last?.answer;
  }
  const answer =
    typeof run === "object" && run.exitCode === 0
      ? { entries: parseStatus(run.stdout), raw: run.stdout }
      : undefined;
  remember(folder, { answer, ...ran });
  return answer;
}
