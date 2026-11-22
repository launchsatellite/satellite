import { realpathOrUndefined, samePath } from "../platform/paths.ts";
import { gitReadMs, runGit } from "./git-command.ts";

export interface ListedWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  initializing: boolean;
  prunable: boolean;
}
type Separator = "\0" | "\n";

const branchPrefix = "refs/heads/";
let separatorKnownUnsupported = false;

function emptyRecord(): ListedWorktree {
  return {
    path: "",
    head: null,
    branch: null,
    detached: false,
    bare: false,
    locked: false,
    initializing: false,
    prunable: false,
  };
}

function readLine(record: ListedWorktree, label: string, value: string): void {
  if (label === "worktree") record.path = value;
  else if (label === "HEAD") record.head = /^0+$/.test(value) ? null : value;
  else if (label === "branch") {
    record.branch = value.startsWith(branchPrefix) ? value.slice(branchPrefix.length) : value;
  } else if (label === "detached") record.detached = true;
  else if (label === "bare") record.bare = true;
  else if (label === "locked") {
    record.locked = true;
    record.initializing = value === "initializing";
  }
  else if (label === "prunable") record.prunable = true;
}

async function listWith(root: string, separator: Separator) {
  const args = ["worktree", "list", "--porcelain", ...(separator === "\0" ? ["-z"] : [])];
  return runGit(root, args, gitReadMs);
}

export function parseWorktreeList(stdout: string, separator: Separator): ListedWorktree[] {
  const worktrees: ListedWorktree[] = [];
  let record = emptyRecord();
  for (const line of [...stdout.split(separator), ""]) {
    if (line === "") {
      if (record.path !== "") worktrees.push(record);
      record = emptyRecord();
      continue;
    }
    const space = line.indexOf(" ");
    if (space === -1) readLine(record, line, "");
    else readLine(record, line.slice(0, space), line.slice(space + 1));
  }
  return worktrees;
}

export async function listWorktrees(
  root: string,
): Promise<{ worktrees: ListedWorktree[]; separator: Separator } | undefined> {
  let separator: Separator = separatorKnownUnsupported ? "\n" : "\0";
  let run = await listWith(root, separator);
  if (separator === "\0" && run?.exitCode === 129 && run.stderr.includes("unknown switch")) {
    separatorKnownUnsupported = true;
    separator = "\n";
    run = await listWith(root, separator);
  }
  if (run?.exitCode !== 0) return undefined;
  return { worktrees: parseWorktreeList(run.stdout, separator), separator };
}

async function commonFolder(folder: string): Promise<string | undefined> {
  const run = await runGit(
    folder,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    gitReadMs,
  );
  const answer = run?.exitCode === 0 ? run.stdout.replace(/\r?\n$/, "") : "";
  if (answer === "" || answer.includes("\n")) return undefined;
  return realpathOrUndefined(answer);
}

export async function sharesRepository(root: string, worktree: string): Promise<boolean> {
  const [own, its] = await Promise.all([commonFolder(root), commonFolder(worktree)]);
  return own !== undefined && its !== undefined && samePath(own, its);
}
