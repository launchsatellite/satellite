import { lstat, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { WorkspaceKey, WorkspaceView } from "../../shared/bridge-contract.ts";
import { BridgeFailure } from "../bridge/registry.ts";
import { samePath } from "../platform/paths.ts";
import { isBranchName } from "../../shared/workspace-name.ts";
import type { StoredProject, StoredWorkspace } from "../projects/projects-file.ts";
import type { Slot } from "../projects/slots.ts";
import { countUnpushed, hasRemote, readTracking } from "./branch-tracking.ts";
import { readStatus } from "./changed-files.ts";
import { gitReadMs, runGit } from "./git-command.ts";
import { listWorktrees, type ListedWorktree } from "./worktree-list.ts";

export interface Drop {
  workspaceId: string;
  sentence: string;
}
interface RecordRead {
  record: StoredWorkspace;
  branch: string | null;
  listed: boolean;
}
type Tracking = Awaited<ReturnType<typeof readTracking>>;
type Status = Awaited<ReturnType<typeof readStatus>>;

const branchLimit = 255;
const sentenceLimit = 300;
const changedCap = 1_000_000;

async function whenGitRuns<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof BridgeFailure && error.code === "tool-missing") return undefined;
    throw error;
  }
}

function shortBranch(branch: string | null | undefined): string | null {
  return branch === null || branch === undefined || branch === ""
    ? null
    : branch.slice(0, branchLimit);
}

async function currentBranch(path: string): Promise<string | null> {
  const run = await whenGitRuns(runGit(path, ["branch", "--show-current"], gitReadMs));
  return run?.exitCode === 0 ? shortBranch(run.stdout.trim()) : null;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function folderDeleted(path: string): Promise<boolean> {
  const gone = await lstat(path).then(
    () => false,
    (error: unknown) => isMissing(error),
  );
  if (!gone) return false;
  return stat(dirname(path)).then(
    (parent) => parent.isDirectory(),
    () => false,
  );
}

function bounded(sentence: string): string {
  return sentence.length <= sentenceLimit ? sentence : `${sentence.slice(0, sentenceLimit - 1)}…`;
}

function dropSentence(
  record: StoredWorkspace,
  projectName: string,
  worktrees: readonly ListedWorktree[],
  prunable: boolean,
): string {
  const { name, branch } = record;
  if (prunable) {
    return `${name} left ${projectName} because its folder was deleted outside Satellite. git still counts ${branch} as checked out there until you run git worktree prune.`;
  }
  const removed = `${name} left ${projectName} because its worktree was removed outside Satellite.`;
  const holder = worktrees.findIndex(
    (worktree) => !worktree.prunable && worktree.branch === branch,
  );
  const holderPath = worktrees[holder]?.path;
  if (holderPath === undefined) return removed;
  const folder = holder === 0 ? projectName : basename(holderPath);
  return `${removed} Its branch ${branch} is checked out in ${folder} now.`;
}

function view(
  key: WorkspaceKey,
  name: string | null,
  branch: string | null,
  tracking: Tracking | undefined,
  unpushed: ReadonlyMap<string, number | null>,
  status: Status,
): WorkspaceView {
  const track = branch === null ? undefined : tracking?.get(branch);
  const ahead = track === null && branch !== null ? (unpushed.get(branch) ?? null) : null;
  return {
    key,
    name,
    branch,
    ahead: track?.ahead ?? ahead,
    behind: track?.behind ?? null,
    changed: status === undefined ? null : Math.min(status.entries.length, changedCap),
  };
}

async function readUnpushed(
  root: string,
  branches: readonly string[],
  inStatusSlot: Slot,
): Promise<Map<string, number | null>> {
  if (branches.length === 0) return new Map();
  if ((await inStatusSlot(() => whenGitRuns(hasRemote(root)))) !== true) return new Map();
  const counts = await Promise.all(
    branches.map((branch) =>
      inStatusSlot(() => whenGitRuns(countUnpushed(root, branch))).then(
        (count): [string, number | null] => [branch, count ?? null],
      ),
    ),
  );
  return new Map(counts);
}

export function blankWorkspace(key: WorkspaceKey, name: string | null): WorkspaceView {
  return { key, name, branch: null, ahead: null, behind: null, changed: null };
}

export async function readWorkspaces(
  project: StoredProject,
  projectName: string,
  busy: ReadonlySet<string>,
  inStatusSlot: Slot,
): Promise<{ workspaces: WorkspaceView[]; drops: Drop[] }> {
  const listed = await whenGitRuns(listWorktrees(project.path));
  const mainBranch =
    listed === undefined
      ? await currentBranch(project.path)
      : shortBranch(listed.worktrees[0]?.branch);
  const reads: RecordRead[] = [];
  const drops: Drop[] = [];
  for (const record of project.workspaces) {
    const worktree = listed?.worktrees.find((listedTree) => samePath(listedTree.path, record.path));
    if (worktree !== undefined && !worktree.prunable) {
      reads.push({ record, branch: shortBranch(worktree.branch), listed: true });
      continue;
    }
    reads.push({ record, branch: null, listed: false });
    if (
      listed === undefined ||
      listed.separator === "\n" ||
      busy.has(record.id) ||
      !(await folderDeleted(record.path))
    ) {
      continue;
    }
    drops.push({
      workspaceId: record.id,
      sentence: bounded(
        dropSentence(record, projectName, listed.worktrees, worktree !== undefined),
      ),
    });
  }
  const live = reads.filter((entry) => entry.listed);
  const branches = [mainBranch, ...live.map((entry) => entry.branch)].filter(
    (branch) => branch !== null,
  );
  const [tracking, [mainStatus, ...statuses]] = await Promise.all([
    inStatusSlot(() => whenGitRuns(readTracking(project.path, branches))),
    Promise.all(
      [project.path, ...live.map((entry) => entry.record.path)].map((path) =>
        inStatusSlot(() => whenGitRuns(readStatus(path))),
      ),
    ),
  ]);
  const withoutUpstream = branches.filter(
    (branch) => isBranchName(branch) && tracking?.get(branch) === null,
  );
  const unpushed = await readUnpushed(project.path, withoutUpstream, inStatusSlot);
  const statusOf = new Map(live.map((entry, index) => [entry.record.id, statuses[index]]));
  return {
    workspaces: [
      view("main", null, mainBranch, tracking, unpushed, mainStatus),
      ...reads.map(({ record, branch, listed: isListed }) =>
        isListed
          ? view(record.id, record.name, branch, tracking, unpushed, statusOf.get(record.id))
          : blankWorkspace(record.id, record.name),
      ),
    ],
    drops,
  };
}
