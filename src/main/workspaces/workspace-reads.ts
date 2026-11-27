import { randomUUID } from "node:crypto";
import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { WorkspaceKey, WorkspaceView } from "../../shared/bridge-contract.ts";
import { BridgeFailure } from "../bridge/registry.ts";
import { isMissing } from "../platform/file-system.ts";
import { isInsidePath, realpathOrUndefined, samePath } from "../platform/paths.ts";
import {
  isBranchName,
  shownWorktreeName,
  workspaceNameProblem,
} from "../../shared/workspace-name.ts";
import {
  outsideLimit,
  workspaceLimit,
  type StoredProject,
  type StoredWorkspace,
} from "../projects/projects-file.ts";
import type { Slot } from "../projects/slots.ts";
import { countUnpushed, hasRemote, readTracking } from "./branch-tracking.ts";
import { pacedStatus, type readStatus } from "./changed-files.ts";
import { gitReadMs, runGit } from "./git-command.ts";
import {
  isOutsideFolder,
  isOutsidePath,
  isOwnShaped,
  isWorktreeFolder,
  ownCount,
  projectSegment,
  worktreesRoot,
} from "./worktree-folders.ts";
import { listWorktrees, sharesRepository, type ListedWorktree } from "./worktree-list.ts";

export interface Drop {
  workspaceId: string;
  projectId: string;
  name: string;
  project: string;
  prunable: boolean;
  quiet: boolean;
  sentence: string;
}
export interface Adoption {
  projectId: string;
  workspace: StoredWorkspace;
}
export interface AdoptionRule {
  home: string;
  blocked: () => boolean;
}
export interface AdoptionInput {
  listed: Listed;
  recorded: readonly string[];
  room: number;
  outsideRoom: number;
  root: string;
  segmentFolder: string;
  blocked: boolean;
}
export interface HalfMade {
  path: string;
  sentence: string;
}
interface RecordRead {
  record: StoredWorkspace;
  branch: string | null;
  listed: boolean;
}
type Tracking = Awaited<ReturnType<typeof readTracking>>;
type Status = Awaited<ReturnType<typeof readStatus>>;
type Listed = Awaited<ReturnType<typeof listWorktrees>>;

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

async function answersAsFolder(path: string): Promise<boolean> {
  return stat(path).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
}

async function folderDeleted(path: string, home: string): Promise<boolean> {
  const gone = await lstat(path).then(
    () => false,
    (error: unknown) => isMissing(error),
  );
  if (!gone) return false;
  const realHome = await realpathOrUndefined(home);
  if (realHome === undefined) return false;
  return answersAsFolder(isInsidePath(worktreesRoot(realHome), path) ? realHome : dirname(path));
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
    outside: false,
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

function halfMadeSentence(project: StoredProject, projectName: string, path: string): string {
  const name = basename(path);
  return bounded(
    `Making ${name} in ${projectName} stopped halfway, so Satellite leaves worktrees/${projectSegment(project.path)}/${name} in the Satellite home out of the list. git worktree remove --force --force on it clears it.`,
  );
}

async function adoptedWorkspaces(
  project: StoredProject,
  projectName: string,
  listed: Listed,
  busy: ReadonlySet<string>,
  rule: AdoptionRule,
): Promise<{ adopted: StoredWorkspace[]; halfMade: HalfMade[] }> {
  let realHome: string;
  try {
    realHome = await realpath(rule.home);
  } catch {
    return { adopted: [], halfMade: [] };
  }
  const realRecords = await Promise.all(
    project.workspaces.map((record) => realpath(record.path).catch(() => record.path)),
  );
  const input = {
    listed,
    recorded: [...project.workspaces.map((record) => record.path), ...realRecords],
    room: workspaceLimit - ownCount(rule.home, project.workspaces),
    outsideRoom:
      outsideLimit - (project.workspaces.length - ownCount(rule.home, project.workspaces)),
    root: worktreesRoot(realHome),
    segmentFolder: join(worktreesRoot(realHome), projectSegment(project.path)),
    blocked: rule.blocked() || project.workspaces.some((record) => busy.has(record.id)),
  };
  const adopted: StoredWorkspace[] = [];
  const room = { own: input.room, outside: input.outsideRoom };
  for (const candidate of adoptable(input)) {
    const kind = isOwnShaped(input.root, candidate.path) ? "own" : "outside";
    if (room[kind] <= 0) continue;
    const folderTrusted =
      kind === "own"
        ? await isWorktreeFolder(rule.home, candidate.path)
        : await isOutsideFolder(rule.home, candidate.path);
    if (folderTrusted && (await sharesRepository(project.path, candidate.path))) {
      adopted.push({ id: randomUUID(), ...candidate });
      room[kind] -= 1;
    }
  }
  if (rule.blocked()) return { adopted: [], halfMade: [] };
  const halfMade = stoppedHalfway(input).map((path) => ({
    path,
    sentence: halfMadeSentence(project, projectName, path),
  }));
  return { adopted, halfMade };
}

function unrecorded(worktree: ListedWorktree, input: AdoptionInput): boolean {
  return !worktree.bare && !input.recorded.some((recorded) => samePath(recorded, worktree.path));
}

function inOwnFolder(worktree: ListedWorktree, input: AdoptionInput): boolean {
  return (
    unrecorded(worktree, input) &&
    samePath(dirname(worktree.path), input.segmentFolder) &&
    workspaceNameProblem(basename(worktree.path)) === null
  );
}

function shownName(worktree: ListedWorktree, input: AdoptionInput): string | undefined {
  if (inOwnFolder(worktree, input)) return basename(worktree.path);
  if (isOwnShaped(input.root, worktree.path) || !unrecorded(worktree, input)) return undefined;
  return shownWorktreeName(basename(worktree.path));
}

export function stoppedHalfway(input: AdoptionInput): string[] {
  const { listed, blocked } = input;
  if (blocked || listed?.separator !== "\0") return [];
  return listed.worktrees
    .slice(1)
    .filter((worktree) => worktree.initializing && inOwnFolder(worktree, input))
    .map((worktree) => worktree.path);
}

export function adoptable(input: AdoptionInput): Omit<StoredWorkspace, "id">[] {
  const { listed, blocked } = input;
  if (blocked || listed?.separator !== "\0") return [];
  const own: Omit<StoredWorkspace, "id">[] = [];
  const outside: Omit<StoredWorkspace, "id">[] = [];
  for (const worktree of listed.worktrees.slice(1)) {
    const { path, branch } = worktree;
    const name = shownName(worktree, input);
    if (
      worktree.prunable ||
      worktree.initializing ||
      branch === null ||
      !isBranchName(branch) ||
      name === undefined
    ) {
      continue;
    }
    if ([...own, ...outside].some((kept) => samePath(kept.path, path))) continue;
    (isOwnShaped(input.root, path) ? own : outside).push({ name, path, branch });
  }
  return [...own, ...outside];
}

function namesList(names: readonly string[], shown: number): string {
  const head = names.slice(0, shown);
  const rest = names.length - shown;
  return rest === 0
    ? `${head.slice(0, -1).join(", ")} and ${head.at(-1) ?? ""}`
    : `${head.join(", ")} and ${String(rest)} more`;
}

function foldedSentence(names: readonly string[], project: string, prune: string): string {
  const count = `${String(names.length)} workspaces left`;
  const why = "because they were removed outside Satellite";
  for (let shown = names.length; shown > 0; shown -= 1) {
    const sentence = `${count} ${project} ${why}, ${namesList(names, shown)}.${prune}`;
    if (sentence.length <= sentenceLimit) return sentence;
  }
  const room = sentenceLimit - `${count}  ${why}.${prune}`.length;
  const shortProject = project.length <= room ? project : `${project.slice(0, room - 1)}…`;
  return `${count} ${shortProject} ${why}.${prune}`;
}

export function droppedSentences(drops: readonly Drop[]): string[] {
  const byProject = new Map<string, Drop[]>();
  for (const drop of drops.filter((dropped) => !dropped.quiet)) {
    byProject.set(drop.projectId, [...(byProject.get(drop.projectId) ?? []), drop]);
  }
  return [...byProject.values()].flatMap((group) => {
    const [first] = group;
    if (first === undefined) return [];
    if (group.length === 1) return [first.sentence];
    const prune = group.some((drop) => drop.prunable)
      ? " git still counts some of their branches as checked out until you run git worktree prune."
      : "";
    return [
      foldedSentence(
        group.map((drop) => drop.name),
        first.project,
        prune,
      ),
    ];
  });
}

export function blankWorkspace(
  key: WorkspaceKey,
  name: string | null,
  outside: boolean,
): WorkspaceView {
  return { key, name, branch: null, ahead: null, behind: null, changed: null, outside };
}

export async function readWorkspaces(
  project: StoredProject,
  projectName: string,
  busy: ReadonlySet<string>,
  inStatusSlot: Slot,
  rule: AdoptionRule,
): Promise<{
  workspaces: WorkspaceView[];
  drops: Drop[];
  adoptions: Adoption[];
  halfMade: HalfMade[];
}> {
  const listed = await whenGitRuns(listWorktrees(project.path));
  const mainBranch =
    listed === undefined
      ? await currentBranch(project.path)
      : shortBranch(listed.worktrees[0]?.branch);
  const realPaths = new Map(
    await Promise.all(
      project.workspaces.map(
        async (record) =>
          [record.id, (await realpathOrUndefined(record.path)) ?? record.path] as const,
      ),
    ),
  );
  const isOutside = (record: StoredWorkspace) =>
    isOutsidePath(rule.home, record.path) &&
    isOutsidePath(rule.home, realPaths.get(record.id) ?? record.path);
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
      (!isOutside(record) && !(await folderDeleted(record.path, rule.home)))
    ) {
      continue;
    }
    drops.push({
      workspaceId: record.id,
      projectId: project.id,
      name: record.name,
      project: projectName,
      prunable: worktree !== undefined,
      quiet: isOutside(record),
      sentence: bounded(
        dropSentence(record, projectName, listed.worktrees, worktree !== undefined),
      ),
    });
  }
  const { adopted, halfMade } = await adoptedWorkspaces(project, projectName, listed, busy, rule);
  for (const record of adopted) reads.push({ record, branch: record.branch, listed: true });
  const live = reads.filter((entry) => entry.listed);
  const branches = [mainBranch, ...live.map((entry) => entry.branch)].filter(
    (branch) => branch !== null,
  );
  const [tracking, [mainStatus, ...statuses]] = await Promise.all([
    inStatusSlot(() => whenGitRuns(readTracking(project.path, branches))),
    Promise.all(
      [project.path, ...live.map((entry) => entry.record.path)].map((path) =>
        inStatusSlot(() => whenGitRuns(pacedStatus(path))),
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
          ? {
              ...view(record.id, record.name, branch, tracking, unpushed, statusOf.get(record.id)),
              outside: isOutside(record),
            }
          : blankWorkspace(record.id, record.name, isOutside(record)),
      ),
    ],
    drops,
    adoptions: adopted.map((workspace) => ({ projectId: project.id, workspace })),
    halfMade,
  };
}
