import { createHash } from "node:crypto";
import { lstat, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { BridgeResponse, LossView } from "../../shared/bridge-contract.ts";
import { BridgeFailure } from "../bridge/registry.ts";
import {
  folderIdentity,
  isMissing,
  sameIdentity,
  type FolderIdentity,
} from "../platform/file-system.ts";
import { samePath } from "../platform/paths.ts";
import type { StoredProject, StoredWorkspace } from "../projects/projects-file.ts";
import type { WorkspaceSessions } from "../terminal/terminal-sessions.ts";
import { hasRemote, parseCount } from "./branch-tracking.ts";
import { readStatus } from "./changed-files.ts";
import { gitReadMs, runGit } from "./git-command.ts";
import { isWorktreeFolder, projectSegment } from "./worktree-folders.ts";
import { listWorktrees, sharesRepository, type ListedWorktree } from "./worktree-list.ts";
import {
  boundaryInside,
  refusedAsUnclean,
  removeWalked,
  uncheckedBecause,
  uncheckedFix,
  walkForRemoval,
  type Kept,
  type Walked,
} from "./worktree-removal.ts";

export type InspectView = BridgeResponse<"workspaces.inspect">;
export type ArchiveResult = BridgeResponse<"workspaces.archive">;
type Submodules = InspectView["submodules"];
interface Inspection {
  view: Omit<InspectView, "boundary" | "sessions" | "fingerprint">;
  core: string;
  identity: FolderIdentity;
}
interface IndexRead {
  hidden: number;
  gitlinks: string[];
}

const shownFiles = 50;
const pathLimit = 4096;
const subjectLimit = 200;
const shownSubjects = 5;
const gitlinkChecks = 1000;
const countCap = 1_000_000;
const notOnAnyRef = ["--not", "--branches", "--remotes", "--tags", "--"];
const notOnRemote = ["--not", "--remotes", "--"];
const submoduleAnswer = "working trees containing submodules cannot be moved or removed";
const indexLine = /^(\S) (\d{6}) [0-9a-f]+ \d\t(.+)$/s;
const oldGitSentence =
  "Satellite archives a workspace only with git 2.36 or newer, which lists worktrees safely. Update git, then try again.";

function unreadable(name: string): BridgeFailure {
  return new BridgeFailure(
    "failed",
    `Satellite couldn't read ${name}, so it won't archive it. Try again.`,
  );
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    (error: unknown) => !isMissing(error),
  );
}

export async function isConfined(home: string, project: StoredProject, record: StoredWorkspace) {
  return (
    samePath(basename(dirname(record.path)), projectSegment(project.path)) &&
    (await isWorktreeFolder(home, record.path))
  );
}

async function countIn(folder: string, rest: readonly string[]): Promise<number | null> {
  const run = await runGit(folder, ["rev-list", "--count", "HEAD", ...rest], gitReadMs);
  return run?.exitCode === 0 ? parseCount(run.stdout) : null;
}

async function subjectsIn(folder: string, rest: readonly string[]): Promise<string[]> {
  const run = await runGit(
    folder,
    ["log", "--no-show-signature", "--format=%s", "-n", String(shownSubjects), "HEAD", ...rest],
    gitReadMs,
  );
  if (run?.exitCode !== 0) return [];
  const lines = run.stdout.endsWith("\n") ? run.stdout.slice(0, -1) : run.stdout;
  return lines
    .split("\n")
    .slice(0, shownSubjects)
    .map((subject) => subject.slice(0, subjectLimit));
}

async function lossOf(root: string, folder: string, listed: ListedWorktree): Promise<LossView> {
  let kind: "lost" | "unpushed" = "lost";
  let rest = notOnAnyRef;
  if (!listed.detached && listed.branch !== null) {
    const remote = await hasRemote(root);
    if (remote === undefined) return { kind: "unknown" };
    if (!remote) return { kind: "no-remote" };
    kind = "unpushed";
    rest = notOnRemote;
  }
  const count = await countIn(folder, rest);
  if (count === null) return { kind: "unknown" };
  return { kind, count, subjects: count === 0 ? [] : await subjectsIn(folder, rest) };
}

export function parseIndex(stdout: string): IndexRead | undefined {
  let hidden = 0;
  const gitlinks: string[] = [];
  for (const line of stdout.split("\0")) {
    if (line === "") continue;
    const match = indexLine.exec(line);
    const [, tag, mode, path] = match ?? [];
    if (tag === undefined || mode === undefined || path === undefined) return undefined;
    if (tag === "S" || tag !== tag.toUpperCase()) hidden += 1;
    if (mode === "160000") gitlinks.push(path);
  }
  return { hidden: Math.min(hidden, countCap), gitlinks };
}

async function readIndex(folder: string): Promise<IndexRead | undefined> {
  const run = await runGit(folder, ["ls-files", "-z", "-v", "-s"], gitReadMs);
  return run?.exitCode === 0 ? parseIndex(run.stdout) : undefined;
}

async function hasModulesFolder(folder: string): Promise<boolean | undefined> {
  const run = await runGit(folder, ["rev-parse", "--git-path", "modules"], gitReadMs);
  const answer = run?.exitCode === 0 ? run.stdout.replace(/\r?\n$/, "") : "";
  if (answer === "" || answer.includes("\n")) return undefined;
  const modules = isAbsolute(answer) ? answer : resolve(folder, answer);
  return lstat(modules).then(
    (entry) => entry.isDirectory(),
    (error: unknown) => (isMissing(error) ? false : undefined),
  );
}

async function submodulesIn(folder: string, index: IndexRead | undefined): Promise<Submodules> {
  const modules = await hasModulesFolder(folder);
  if (modules === true) return "checked-out";
  if (modules === undefined) return "unknown";
  if (index === undefined) {
    return (await exists(join(folder, ".gitmodules"))) ? "unknown" : "none";
  }
  if (index.gitlinks.length > gitlinkChecks) return "unknown";
  for (const path of index.gitlinks) {
    const parts = path.split("/");
    if (parts.some((part) => part === "" || part === "." || part === "..")) return "unknown";
    if (await exists(join(folder, ...parts, ".git"))) return "checked-out";
  }
  return "none";
}

async function readInspection(
  home: string,
  project: StoredProject,
  record: StoredWorkspace,
): Promise<Inspection> {
  const failure = unreadable(record.name);
  const folder = leftoverFolder(project, record);
  if (!(await isConfined(home, project, record))) {
    const gone = await lstat(record.path).then(
      () => false,
      (error: unknown) => isMissing(error),
    );
    if (!gone) throw failure;
    throw new BridgeFailure(
      "refused",
      `Satellite can't find ${record.name}'s folder ${folder} in the Satellite home, so it won't archive it.`,
    );
  }
  const identity = await folderIdentity(record.path);
  if (identity === undefined) throw failure;
  const listing = await listWorktrees(project.path);
  if (listing === undefined) throw failure;
  if (listing.separator !== "\0") throw new BridgeFailure("refused", oldGitSentence);
  const listed = listing.worktrees
    .slice(1)
    .find((worktree) => samePath(worktree.path, record.path));
  if (listed === undefined || listed.prunable) {
    throw new BridgeFailure(
      "refused",
      `git no longer counts ${record.name} as a worktree, so Satellite won't archive it. Its folder stays in ${folder} in the Satellite home, and once you move it out of there Satellite forgets the workspace.`,
    );
  }
  if (listed.bare) throw failure;
  if (!(await sharesRepository(project.path, record.path))) throw failure;
  const status = await readStatus(record.path);
  if (status === undefined) throw failure;
  const index = await readIndex(record.path);
  const submodules = await submodulesIn(record.path, index);
  const commits = await lossOf(project.path, record.path, listed);
  const branch = listed.detached ? null : listed.branch;
  const view = {
    branch: branch === null ? null : branch.slice(0, 255),
    files: status.entries
      .slice(0, shownFiles)
      .map(({ code, path }) => ({ code, path: path.slice(0, pathLimit) })),
    moreFiles: Math.min(Math.max(0, status.entries.length - shownFiles), countCap),
    repositories: Math.min(
      status.entries.filter(({ code, path }) => code === "??" && path.endsWith("/")).length,
      countCap,
    ),
    hidden: index?.hidden ?? null,
    submodules,
    commits,
    locked: listed.locked,
  };
  const core = hashOf([String(identity.dev), String(identity.ino), listed.head, status.raw, view]);
  return { identity, core, view };
}

function fingerprintOf(core: string, sessions: number): string {
  return hashOf([core, sessions]);
}

function keptFailure(name: string, kept: Kept, linksRemoved: number): BridgeFailure {
  switch (kept.kind) {
    case "unchecked":
      return new BridgeFailure(
        "refused",
        `Satellite won't let git delete ${name}, because ${uncheckedBecause(kept.why)}. ${uncheckedFix(kept.why, "try again")} Nothing was removed.`,
      );
    case "mount":
      return new BridgeFailure(
        "refused",
        `${name} holds a folder from another drive at ${kept.at}, so Satellite won't archive it. Unmount it, then try again. Nothing was removed.`,
      );
    case "link":
      return new BridgeFailure(
        "failed",
        linksRemoved > 0
          ? `Satellite couldn't remove the link ${kept.at} inside ${name}, so it won't let git delete the folder. Links it removed before are gone, and what they pointed to is untouched.`
          : `Satellite couldn't remove the link ${kept.at} inside ${name}, so it won't let git delete the folder. Nothing was removed.`,
      );
  }
}

async function removeFromGit(
  root: string,
  walked: Extract<Walked, { kind: "walked" }>,
  name: string,
  seenUnclean: boolean,
): Promise<void> {
  const { path } = walked;
  const removal = await removeWalked(root, walked, {
    force: false,
    locked: false,
    forceWhenUnclean: seenUnclean,
  });
  if (removal.kind === "kept") throw keptFailure(name, removal.kept, removal.linksRemoved);
  const { run, forced, linksRemoved } = removal;
  if (!forced && !seenUnclean && refusedAsUnclean(run)) {
    throw new BridgeFailure(
      "refused",
      linksRemoved > 0
        ? `Something changed in ${name} since you looked, so git removed nothing. Links Satellite removed inside it are gone, and what they pointed to is untouched.`
        : `Something changed in ${name} since you looked. Here is the latest.`,
    );
  }
  if (run === undefined) {
    throw new BridgeFailure(
      "failed",
      `git didn't finish removing ${name} within 2 minutes, so some of its files may be gone already. The branch stays.`,
    );
  }
  if (run.exitCode !== 0 && run.stderr.includes(submoduleAnswer)) {
    throw new BridgeFailure(
      "refused",
      `${name} has submodules checked out, and git would delete their own history with it, so Satellite won't archive it.`,
    );
  }
  const listing = await listWorktrees(root);
  const listed = listing?.worktrees.some((worktree) => samePath(worktree.path, path));
  if (listed === true) {
    throw new BridgeFailure(
      "failed",
      forced || linksRemoved > 0
        ? `git couldn't finish removing the worktree, so some of ${name}'s files or links may be gone. The branch stays.`
        : `git couldn't remove the worktree, so ${name} stays as it was.`,
    );
  }
  if (listed === undefined) {
    throw new BridgeFailure(
      "failed",
      `Satellite couldn't tell whether git removed ${name}. The branch stays, and the next list shows what is left.`,
    );
  }
}

function leftoverFolder(project: StoredProject, record: StoredWorkspace): string {
  return `worktrees/${projectSegment(project.path)}/${basename(record.path)}`;
}

export async function inspectWorkspace(
  home: string,
  project: StoredProject,
  record: StoredWorkspace,
  sessions: number,
): Promise<InspectView> {
  const { view, core } = await readInspection(home, project, record);
  const boundary = await boundaryInside(record.path);
  return { ...view, boundary, sessions, fingerprint: fingerprintOf(core, sessions) };
}

export async function archiveWorkspace(
  home: string,
  project: StoredProject,
  record: StoredWorkspace,
  fingerprint: string,
  sessions: WorkspaceSessions,
): Promise<ArchiveResult> {
  const { name, path } = record;
  const changed = new BridgeFailure(
    "refused",
    `Something changed in ${name} since you looked. Here is the latest.`,
  );
  const seen = await readInspection(home, project, record);
  if (fingerprintOf(seen.core, sessions.countInside(path)) !== fingerprint) throw changed;
  if (seen.view.locked) {
    throw new BridgeFailure(
      "refused",
      `${name} is locked in git, so Satellite won't archive it. Run git worktree unlock on it first.`,
    );
  }
  if (seen.view.submodules !== "none") {
    throw new BridgeFailure(
      "refused",
      seen.view.submodules === "checked-out"
        ? `${name} has submodules checked out, and git would delete their own history with it, so Satellite won't archive it.`
        : `Satellite couldn't check whether ${name} has submodules checked out, so it won't archive it.`,
    );
  }
  await sessions.stopInside(path);
  const walked = await walkForRemoval(path);
  if (walked.kind === "kept") throw keptFailure(name, walked.kept, 0);
  const latest = await readInspection(home, project, record);
  if (latest.core !== seen.core) throw changed;
  await removeFromGit(project.path, walked, name, latest.view.files.length > 0);
  if (
    sameIdentity(await folderIdentity(path), latest.identity) &&
    (await isConfined(home, project, record))
  ) {
    await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(
      () => undefined,
    );
  }
  return { leftover: (await exists(path)) ? leftoverFolder(project, record) : null };
}
