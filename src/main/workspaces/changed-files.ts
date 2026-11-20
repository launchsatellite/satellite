import { gitReadMs, runGit } from "./git-command.ts";

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
  const run = await runGit(folder, statusArgs, gitReadMs);
  if (run?.exitCode !== 0) return undefined;
  return { entries: parseStatus(run.stdout), raw: run.stdout };
}
