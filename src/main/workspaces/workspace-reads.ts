import { lstat, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { WorkspaceKey, WorkspaceView } from "../../shared/bridge-contract.ts";
import { BridgeFailure } from "../bridge/registry.ts";
import { samePath } from "../platform/paths.ts";
import type { StoredProject, StoredWorkspace } from "../projects/projects-file.ts";
import type { Slot } from "../projects/slots.ts";
import { readTracking } from "./branch-tracking.ts";
import { readStatus } from "./changed-files.ts";
import { gitReadMs, runGit } from "./git-command.ts";
import { listWorktrees, type ListedWorktree } from "./worktree-list.ts";

export interface Drop {
  workspaceId: string;
  sentence: string;
}
interface KeptRecord {
  record: StoredWorkspace;
  branch: string | null;
  listed: boolean;
}

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
  tracking: Awaited<ReturnType<typeof readTracking>> | undefined,
  status: Awaited<ReturnType<typeof readStatus>>,
): WorkspaceView {
  const track = branch === null ? undefined : tracking?.get(branch);
  return {
    key,
    name,
    branch,
    ahead: track?.ahead ?? null,
    behind: track?.behind ?? null,
    changed: status === undefined ? null : Math.min(status.entries.length, changedCap),
  };
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
  const kept: KeptRecord[] = [];
  const drops: Drop[] = [];
  for (const record of project.workspaces) {
    const worktree = listed?.worktrees.find((listedTree) => samePath(listedTree.path, record.path));
    if (worktree !== undefined && !worktree.prunable) {
      kept.push({ record, branch: shortBranch(worktree.branch), listed: true });
      continue;
    }
    if (
      listed === undefined ||
      listed.separator === "\n" ||
      busy.has(record.id) ||
      (worktree !== undefined && !(await folderDeleted(record.path)))
    ) {
      kept.push({ record, branch: null, listed: false });
      continue;
    }
    drops.push({
      workspaceId: record.id,
      sentence: bounded(
        dropSentence(record, projectName, listed.worktrees, worktree !== undefined),
      ),
    });
  }
  const live = kept.filter((entry) => entry.listed);
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
  const statusOf = new Map(live.map((entry, index) => [entry.record.id, statuses[index]]));
  return {
    workspaces: [
      view("main", null, mainBranch, tracking, mainStatus),
      ...kept.map(({ record, branch, listed: isListed }) =>
        isListed
          ? view(record.id, record.name, branch, tracking, statusOf.get(record.id))
          : blankWorkspace(record.id, record.name),
      ),
    ],
    drops,
  };
}
