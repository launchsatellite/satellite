import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { StartChoice, StartView } from "../../shared/bridge-contract.ts";
import { isBranchName, isStartRef } from "../../shared/workspace-name.ts";
import { BridgeFailure } from "../bridge/registry.ts";
import { samePath } from "../platform/paths.ts";
import type { ToolRun } from "../platform/tools.ts";
import type { StoredWorkspace } from "../projects/projects-file.ts";
import {
  branchMs,
  fetchMs,
  gitReadMs,
  ignoredListMs,
  lsRemoteMs,
  runGit,
  worktreeAddMs,
  worktreeRemoveMs,
} from "./git-command.ts";
import { collectIncludedFiles, copyIncludedFiles } from "./include-copy.ts";
import { createIncludeMatcher, parseWorktreeInclude } from "./worktree-include.ts";
import {
  isWorktreeFolder,
  prepareWorktreeFolder,
  projectSegment,
  worktreesRoot,
} from "./worktree-folders.ts";
import { suggestName } from "./workspace-names.ts";
import { listWorktrees } from "./worktree-list.ts";
import type { CreationResult, CreationStepRun } from "./workspace-creation.ts";
import { StepFailure } from "./workspace-creation.ts";

export interface CreationContext {
  home: string;
  root: string;
  project: string;
  name: string;
  start: StartChoice;
  save(workspace: StoredWorkspace): Promise<void>;
  signal: AbortSignal;
}
export interface PreparedWorkspace {
  name: string;
  start: StartView;
  branches: { ref: string; label: string }[];
}
interface MadeFolder {
  path: string;
  dev: number;
  ino: number;
}
interface Shared {
  oid: string | null;
  branchMade: boolean;
  folder: MadeFolder | null;
  worktreeLeft: boolean;
}

const includeFilesMs = 120_000;

const remotePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const signInPattern =
  /unable to get password from user|could not read (?:Username|Password)|terminal prompts disabled|Authentication failed|Permission denied \(publickey/;
const remoteHeadPattern = /^refs\/remotes\/[^/]+\/HEAD$/;
const startPrefixes = ["refs/heads/", "refs/remotes/"];
const includeLimit = 65536;
const branchListLimit = 200;
const branchLabelLimit = 255;
const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
const nonBlocking = "O_NONBLOCK" in constants ? constants.O_NONBLOCK : 0;
const quitSentence = "Satellite stopped making the workspace because it is quitting.";
const checkoutSentence =
  "git couldn't check out the worktree, or one of the repository's hooks failed.";
const copySentence = "Satellite couldn't copy the files .worktreeinclude lists.";
const includeUnreadable =
  ".worktreeinclude isn't a plain file of at most 64 KiB, so Satellite won't read it.";
const includeTooMuch =
  ".worktreeinclude matches more than 10000 files or 1 GiB. Narrow it, then try again.";
const includeTooSlow =
  "Copying the files .worktreeinclude lists took longer than 2 minutes. Narrow it, then try again.";

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function label(ref: string): string {
  const prefix = startPrefixes.find((candidate) => ref.startsWith(candidate));
  return prefix === undefined ? ref : ref.slice(prefix.length);
}

function clashesWith(lowerRef: string, wanted: string): boolean {
  return lowerRef === wanted || lowerRef.startsWith(`${wanted}/`);
}

function stopIfQuitting(signal: AbortSignal): void {
  if (signal.aborted) throw new StepFailure(quitSentence);
}

async function git(
  root: string,
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ToolRun | undefined> {
  try {
    return await runGit(root, args, timeoutMs, signal);
  } catch (error) {
    if (error instanceof BridgeFailure) throw new StepFailure(error.message);
    throw error;
  }
}

function pickRemote(stdout: string): string | null {
  const remotes = stdout.split("\n").filter((remote) => remote !== "");
  const chosen = remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : null;
  return chosen !== undefined && chosen !== null && remotePattern.test(chosen) ? chosen : null;
}

async function chosenRemote(root: string): Promise<string | null> {
  const run = await git(root, ["remote"], gitReadMs);
  if (run?.exitCode !== 0) throw new Error("git remote did not answer");
  return pickRemote(run.stdout);
}

async function cachedDefault(root: string, remote: string): Promise<string | null> {
  const run = await git(
    root,
    ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`],
    gitReadMs,
  );
  const prefix = `refs/remotes/${remote}/`;
  const ref = run?.exitCode === 0 ? run.stdout.trim() : "";
  const branch = ref.startsWith(prefix) ? ref.slice(prefix.length) : "";
  return isBranchName(branch) ? branch : null;
}

async function remoteDefault(root: string, remote: string, signal: AbortSignal) {
  const run = await git(
    root,
    ["ls-remote", "--symref", "--end-of-options", remote, "HEAD"],
    lsRemoteMs,
    signal,
  );
  if (run?.exitCode !== 0) return null;
  const line = run.stdout.split("\n").find((candidate) => candidate.startsWith("ref: refs/heads/"));
  const match = line === undefined ? null : /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line);
  const branch = match?.[1] ?? "";
  return isBranchName(branch) ? branch : null;
}

async function refOid(root: string, ref: string): Promise<string | null> {
  const run = await git(root, ["show-ref", "--verify", ref], gitReadMs);
  const oid = run?.exitCode === 0 ? (run.stdout.split(" ")[0] ?? "") : "";
  return oidPattern.test(oid) ? oid : null;
}

async function branchExists(root: string, name: string): Promise<boolean | undefined> {
  const run = await git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], gitReadMs);
  if (run?.exitCode === 0) return true;
  return run?.exitCode === 1 ? false : undefined;
}

async function branchClash(
  root: string,
  name: string,
  project: string,
): Promise<string | null | undefined> {
  const run = await git(root, ["for-each-ref", "--format=%(refname)", "refs/heads/"], gitReadMs);
  if (run?.exitCode !== 0) return undefined;
  const wanted = `refs/heads/${name}`;
  const refs = run.stdout.split("\n").filter((ref) => ref !== "");
  if (refs.includes(wanted)) return branchTakenSentence(name, project);
  const clash = refs.find((ref) => clashesWith(ref.toLowerCase(), wanted));
  if (clash === undefined) return null;
  return `${project} already has a branch named ${label(clash).slice(0, branchLabelLimit)}, which git can't keep next to ${name} on every system. Pick another name.`;
}

async function isListed(root: string, path: string): Promise<boolean | undefined> {
  const listing = await listWorktrees(root);
  return listing?.worktrees.some((worktree) => samePath(worktree.path, path));
}

async function isMadeFolder(folder: MadeFolder): Promise<boolean> {
  try {
    const entry = await lstat(folder.path);
    return entry.isDirectory() && entry.dev === folder.dev && entry.ino === folder.ino;
  } catch {
    return false;
  }
}

async function isGone(path: string): Promise<boolean> {
  return lstat(path).then(
    () => false,
    (error: unknown) => errorCode(error) === "ENOENT",
  );
}

function needsSignIn(run: ToolRun | undefined): boolean {
  return run !== undefined && signInPattern.test(run.stderr);
}

async function startFromMain(root: string, project: string, shared: Shared): Promise<string> {
  const main = (await listWorktrees(root))?.worktrees[0];
  if (main === undefined) throw new Error("git worktree list did not answer");
  if (main.head === null || !oidPattern.test(main.head)) {
    throw new StepFailure(
      `${project} has no commits yet. Make a first commit, then make a workspace.`,
    );
  }
  shared.oid = main.head;
  return main.branch !== null && isBranchName(main.branch)
    ? `${project} has no remote, so it starts from ${main.branch}.`
    : `${project} has no remote, so it starts from the current commit.`;
}

async function startFromDefault(context: CreationContext, shared: Shared): Promise<string> {
  const { root, project, signal } = context;
  const remote = await chosenRemote(root);
  if (remote === null) return startFromMain(root, project, shared);
  const branch = (await cachedDefault(root, remote)) ?? (await remoteDefault(root, remote, signal));
  stopIfQuitting(signal);
  if (branch === null) {
    throw new StepFailure(
      `Satellite couldn't find the default branch of ${remote}. Start from a branch you have instead.`,
    );
  }
  const fetched = await git(
    root,
    [
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--no-write-fetch-head",
      "--end-of-options",
      remote,
      `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
    ],
    fetchMs,
    signal,
  );
  stopIfQuitting(signal);
  shared.oid = await refOid(root, `refs/remotes/${remote}/${branch}`);
  const signIn = needsSignIn(fetched);
  if (shared.oid === null) {
    throw new StepFailure(
      signIn
        ? `Satellite couldn't sign in to ${remote} and has no copy of ${branch} yet. Set up a credential helper or an ssh agent, or start from a branch you have.`
        : `Satellite couldn't reach ${remote} and has no copy of ${branch} yet. Connect, or start from a branch you have.`,
    );
  }
  if (fetched?.exitCode === 0) return `Fetched ${branch} from ${remote}.`;
  return signIn
    ? `Couldn't sign in to ${remote}, so it starts from ${remote}/${branch} as last fetched. Set up a credential helper or an ssh agent to fetch.`
    : `Couldn't reach ${remote}, so it starts from ${remote}/${branch} as last fetched.`;
}

function startStep(context: CreationContext, shared: Shared): CreationStepRun {
  return {
    id: "start",
    async run() {
      const { start, root, project } = context;
      if (start.kind === "default") return startFromDefault(context, shared);
      shared.oid = await refOid(root, start.ref);
      if (shared.oid === null) {
        throw new StepFailure(
          `${label(start.ref)} isn't in ${project} anymore. Pick another starting point.`,
        );
      }
      return `Starts from ${label(start.ref)}.`;
    },
  };
}

function branchStep(context: CreationContext, shared: Shared): CreationStepRun {
  const { root, name, project, signal } = context;
  const failure = `git couldn't make the branch ${name}.`;
  return {
    id: "branch",
    async run() {
      const clash = await branchClash(root, name, project);
      if (clash !== null && clash !== undefined) throw new StepFailure(clash);
      if (clash === undefined || shared.oid === null) throw new StepFailure(failure);
      stopIfQuitting(signal);
      const made = await git(
        root,
        ["branch", "--no-track", "--end-of-options", name, shared.oid],
        branchMs,
        signal,
      );
      shared.branchMade = made === undefined || made.exitCode === 0;
      stopIfQuitting(signal);
      if (made?.exitCode !== 0) throw new StepFailure(failure);
      return null;
    },
    async undo() {
      if (!shared.branchMade || shared.oid === null) return true;
      if (shared.worktreeLeft) return false;
      const removed = await git(
        root,
        ["update-ref", "-d", `refs/heads/${name}`, shared.oid],
        branchMs,
      );
      if (removed?.exitCode === 0) return true;
      return (await branchExists(root, name)) === false;
    },
  };
}

async function makeLeafFolder(path: string, name: string, segment: string): Promise<MadeFolder> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    throw new StepFailure(
      `A folder named ${name} is already in Satellite's worktrees for ${segment}. Pick another name.`,
    );
  }
  const made = await lstat(path);
  return { path, dev: made.dev, ino: made.ino };
}

async function isSafeWorktree(home: string, folder: MadeFolder): Promise<boolean> {
  return (await isMadeFolder(folder)) && (await isWorktreeFolder(home, folder.path));
}

function worktreeStep(context: CreationContext, shared: Shared): CreationStepRun {
  const { home, root, name, signal } = context;
  return {
    id: "worktree",
    async run() {
      const prepared = await prepareWorktreeFolder(home, root, name);
      if (!prepared.ok) throw new StepFailure(prepared.refusal);
      if ((await isListed(root, prepared.path)) !== false) {
        throw new StepFailure(
          `git still lists a worktree at the folder for ${name}. Run git worktree prune, then try again.`,
        );
      }
      stopIfQuitting(signal);
      const folder = await makeLeafFolder(prepared.path, name, prepared.segment);
      shared.folder = folder;
      const added = await git(
        root,
        ["worktree", "add", "--end-of-options", folder.path, name],
        worktreeAddMs,
        signal,
      );
      stopIfQuitting(signal);
      if (added?.exitCode !== 0) throw new StepFailure(checkoutSentence);
      if ((await isListed(root, folder.path)) !== true || !(await isSafeWorktree(home, folder))) {
        throw new StepFailure(checkoutSentence);
      }
      return null;
    },
    async undo() {
      const folder = shared.folder;
      if (folder === null) return true;
      shared.worktreeLeft = true;
      if (await isSafeWorktree(home, folder)) {
        const listing = await listWorktrees(root);
        if (listing === undefined) return false;
        const entry = listing.worktrees.find((worktree) => samePath(worktree.path, folder.path));
        if (entry !== undefined) {
          const force = entry.locked ? ["--force", "--force"] : ["--force"];
          await git(
            root,
            ["worktree", "remove", ...force, "--end-of-options", folder.path],
            worktreeRemoveMs,
          );
        }
        if (await isSafeWorktree(home, folder)) {
          await rm(folder.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        }
      }
      shared.worktreeLeft =
        (await isListed(root, folder.path)) !== false || !(await isGone(folder.path));
      return !shared.worktreeLeft;
    },
  };
}

async function readAll(path: string, expected: { dev: number; ino: number }): Promise<string> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | noFollow | nonBlocking);
  } catch {
    throw new StepFailure(includeUnreadable);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.dev !== expected.dev || info.ino !== expected.ino) {
      throw new StepFailure(includeUnreadable);
    }
    const buffer = Buffer.alloc(includeLimit + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > includeLimit) throw new StepFailure(includeUnreadable);
    }
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readInclude(root: string): Promise<string | null> {
  const path = join(root, ".worktreeinclude");
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new StepFailure(includeUnreadable);
  }
  if (!entry.isFile() || entry.size > includeLimit) throw new StepFailure(includeUnreadable);
  return readAll(path, entry);
}

async function beforeDeadline<T>(
  work: Promise<T>,
  deadline: number,
  signal: AbortSignal,
): Promise<T | "late"> {
  work.catch(() => undefined);
  const stop = AbortSignal.any([signal, AbortSignal.timeout(Math.max(0, deadline - Date.now()))]);
  if (stop.aborted) return "late";
  const late = new Promise<"late">((resolve) => {
    stop.addEventListener(
      "abort",
      () => {
        resolve("late");
      },
      { once: true },
    );
  });
  return Promise.race([work, late]);
}

function copiedDetail(copied: number, skipped: number): string {
  const count = copied === 1 ? "Copied 1 file." : `Copied ${String(copied)} files.`;
  return skipped > 0
    ? `${count} Skipped ${String(skipped)} that were links or already in the checkout.`
    : count;
}

function filesStep(context: CreationContext, shared: Shared): CreationStepRun {
  const { home, root, signal } = context;
  return {
    id: "files",
    async run() {
      const text = await readInclude(root);
      if (text === null) return "No .worktreeinclude, so nothing to copy.";
      const deadline = Date.now() + includeFilesMs;
      const ignored = await git(
        root,
        [
          "ls-files",
          "-z",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--directory",
          "--no-empty-directory",
        ],
        ignoredListMs,
        signal,
      );
      stopIfQuitting(signal);
      if (ignored?.exitCode !== 0) throw new StepFailure("git couldn't list the ignored files.");
      const matcher = createIncludeMatcher(parseWorktreeInclude(text));
      const entries = ignored.stdout.split("\0").filter((entry) => entry !== "");
      const limit = { deadline, signal };
      const selection = await beforeDeadline(
        collectIncludedFiles(root, entries, matcher, limit),
        deadline,
        signal,
      );
      stopIfQuitting(signal);
      if (selection === "late" || selection === "too-slow") throw new StepFailure(includeTooSlow);
      if (selection === "too-many" || selection === "too-large") {
        throw new StepFailure(includeTooMuch);
      }
      if (selection.files.length === 0 && selection.links === 0) {
        return "Nothing in .worktreeinclude matched an ignored file.";
      }
      const folder = shared.folder;
      if (folder === null || !(await isSafeWorktree(home, folder))) {
        throw new StepFailure(copySentence);
      }
      const copy = await copyIncludedFiles(root, folder.path, selection.files, limit);
      stopIfQuitting(signal);
      if (copy === "too-slow") throw new StepFailure(includeTooSlow);
      return copiedDetail(copy.copied, copy.skipped + selection.links);
    },
    undo: () => Promise.resolve(true),
  };
}

function saveStep(context: CreationContext, shared: Shared): CreationStepRun {
  const { name, signal } = context;
  return {
    id: "save",
    async run() {
      stopIfQuitting(signal);
      if (shared.folder === null) throw new Error("the worktree step made no folder");
      try {
        await context.save({ id: randomUUID(), name, path: shared.folder.path, branch: name });
      } catch (error) {
        if (!(error instanceof BridgeFailure)) throw error;
        throw new StepFailure(
          error.code === "limit" ? error.message : "Satellite couldn't save the workspace list.",
        );
      }
      return null;
    },
  };
}

async function folderEntries(home: string, root: string): Promise<string[]> {
  try {
    return await readdir(join(worktreesRoot(home), projectSegment(root)));
  } catch {
    return [];
  }
}

async function refList(root: string, args: readonly string[]): Promise<string[]> {
  const run = await runGit(root, ["for-each-ref", ...args], gitReadMs);
  return run?.exitCode === 0 ? run.stdout.split("\n").filter((ref) => ref !== "") : [];
}

export function branchTakenSentence(name: string, project: string): string {
  return `A branch named ${name} already exists in ${project}. Pick another name.`;
}

export async function nameTaken(
  home: string,
  root: string,
  name: string,
  project: string,
): Promise<string | null> {
  const clash = await branchClash(root, name, project);
  if (clash !== null && clash !== undefined) return clash;
  const entries = await folderEntries(home, root);
  if (!entries.some((entry) => entry.toLowerCase() === name)) return null;
  return `A folder named ${name} is already in Satellite's worktrees for ${projectSegment(root)}. Pick another name.`;
}

export function failureSentence(
  result: Extract<CreationResult, { ok: false }>,
  name: string,
  project: string,
): string {
  if (result.step === "start") return result.sentence;
  return result.undone
    ? `${result.sentence} Satellite removed what it had made, so nothing changed.`
    : `${result.sentence} Satellite couldn't undo all of it. Check git worktree list and the branch ${name} in ${project}.`;
}

export function creationSteps(context: CreationContext): CreationStepRun[] {
  const shared: Shared = { oid: null, branchMade: false, folder: null, worktreeLeft: false };
  return [
    startStep(context, shared),
    branchStep(context, shared),
    worktreeStep(context, shared),
    filesStep(context, shared),
    saveStep(context, shared),
  ];
}

export async function prepareWorkspace(root: string, home: string): Promise<PreparedWorkspace> {
  const heads = await refList(root, ["--format=%(refname)", "refs/heads/"]);
  const lowerHeads = heads.map((ref) => ref.toLowerCase());
  const folders = new Set((await folderEntries(home, root)).map((entry) => entry.toLowerCase()));
  const name = suggestName(
    (candidate) =>
      folders.has(candidate) ||
      lowerHeads.some((ref) => clashesWith(ref, `refs/heads/${candidate}`)),
  );
  const main = (await listWorktrees(root))?.worktrees[0];
  const mainBranch =
    main?.branch !== undefined && main.branch !== null && isBranchName(main.branch)
      ? main.branch
      : null;
  let start: StartView = { kind: "local", branch: mainBranch };
  if (main?.head === null) start = { kind: "empty" };
  else {
    const remotes = await runGit(root, ["remote"], gitReadMs);
    const remote = remotes?.exitCode === 0 ? pickRemote(remotes.stdout) : null;
    const branch = remote === null ? null : await cachedDefault(root, remote);
    if (remote !== null && branch !== null) start = { kind: "remote", remote, branch };
  }
  const refs = await refList(root, [
    "--sort=-committerdate",
    `--count=${String(branchListLimit)}`,
    "--format=%(refname)",
    "refs/heads",
    "refs/remotes",
  ]);
  const branches = refs
    .filter((ref) => !remoteHeadPattern.test(ref) && isStartRef(ref))
    .map((ref) => ({ ref, label: label(ref) }));
  return { name, start, branches };
}
