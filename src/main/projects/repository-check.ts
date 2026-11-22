import { realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BridgeFailure } from "../bridge/registry.ts";
import { isFullyQualified, isInsidePath, samePath } from "../platform/paths.ts";
import { runTool, type ToolRun } from "../platform/tools.ts";
import {
  honoursNoLazyFetch,
  partialCloneRefusal,
  refusesReads,
  repositoryConfig,
} from "../workspaces/repository-config.ts";

export type RevParse =
  | { kind: "work-tree"; toplevel: string; gitDir: string; commonDir: string; linked: boolean }
  | { kind: "bare" }
  | { kind: "git-dir" }
  | { kind: "not-a-repository" }
  | { kind: "untrusted" }
  | { kind: "outdated" }
  | { kind: "unknown" };
export type RepositoryCheck = { ok: true; root: string } | { ok: false; refusal: string };
interface FolderRead {
  real: string;
  isFolder: boolean;
  home: string;
}

export const gitReadTimeoutMs = 5000;
export const folderReadMs = 6000;

const revParseArgs = [
  "rev-parse",
  "--path-format=absolute",
  "--is-bare-repository",
  "--is-inside-git-dir",
  "--git-dir",
  "--git-common-dir",
  "--show-toplevel",
];
const ownFolder = "That folder belongs to Satellite itself. Add a repository from somewhere else.";
const missingFolder = "That folder no longer exists. Choose another one.";
const ownCheckout = "Satellite needs a repository with its own checkout.";
const ownGitFolder = "Satellite needs a repository with its own .git folder inside it.";
const slowFolder =
  "That folder didn't answer within 6 seconds. Check the drive it's on, then try again.";
const stillWaiting =
  "Satellite is still waiting on a folder that didn't answer. Try again in a moment.";
let unanswered: Promise<unknown> | undefined;

async function realFolder(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

function folderName(path: string): string {
  return basename(path) || path;
}

async function readFolder(folder: string, home: string): Promise<FolderRead | undefined> {
  const real = await realFolder(folder);
  if (real === undefined) return undefined;
  const isFolder = await stat(real).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
  return { real, isFolder, home: (await realFolder(home)) ?? home };
}

async function boundedRead(folder: string, home: string): Promise<FolderRead | undefined | "slow"> {
  const read = readFolder(folder, home);
  const answer = await answerWithin(read, folderReadMs);
  if (answer !== "late") return answer;
  const pending = read.finally(() => {
    if (unanswered === pending) unanswered = undefined;
  });
  unanswered = pending;
  return "slow";
}

async function revParse(folder: string): Promise<RevParse> {
  let run: ToolRun | undefined;
  try {
    run = await runTool("git", ["-C", folder, ...revParseArgs], {
      timeoutMs: gitReadTimeoutMs,
    });
  } catch {
    return { kind: "unknown" };
  }
  if (run === undefined) {
    throw new BridgeFailure(
      "tool-missing",
      "Satellite needs git to read the folder. Install git, then try again.",
    );
  }
  return parseRevParse(run);
}

function refuse(refusal: string): RepositoryCheck {
  return { ok: false, refusal };
}

export async function answerWithin<T>(work: Promise<T>, ms: number): Promise<T | "late"> {
  const controller = new AbortController();
  const late = delay(ms, undefined, { signal: controller.signal }).then(
    (): "late" => "late",
    (): "late" => "late",
  );
  try {
    return await Promise.race([work, late]);
  } finally {
    controller.abort();
  }
}

export function parseRevParse(run: ToolRun): RevParse {
  const lines = run.stdout.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const [bare, insideGitDir, gitDir, commonDir, toplevel] = lines;
  if (bare === "--path-format=absolute") return { kind: "outdated" };
  if (bare === "true") return { kind: "bare" };
  if (insideGitDir === "true") return { kind: "git-dir" };
  if (
    run.exitCode === 0 &&
    lines.length === 5 &&
    gitDir !== undefined &&
    commonDir !== undefined &&
    toplevel !== undefined
  ) {
    return { kind: "work-tree", toplevel, gitDir, commonDir, linked: !samePath(gitDir, commonDir) };
  }
  if (run.stderr.includes("dubious ownership")) return { kind: "untrusted" };
  if (run.stderr.includes("not a git repository")) return { kind: "not-a-repository" };
  return { kind: "unknown" };
}

export async function checkRepository(folder: string, home: string): Promise<RepositoryCheck> {
  if (!isFullyQualified(folder)) return refuse(missingFolder);
  if (unanswered !== undefined) return refuse(stillWaiting);
  const read = await boundedRead(folder, home);
  if (read === "slow") return refuse(slowFolder);
  if (read === undefined) return refuse(missingFolder);
  const { real } = read;
  if (!read.isFolder) return refuse("Drop a folder, not a file.");
  if (dirname(real) === real) {
    return refuse("That's a whole drive. Choose the folder a repository was cloned into.");
  }
  if (isInsidePath(read.home, real)) return refuse(ownFolder);
  const name = folderName(real);
  const parsed = await revParse(real);
  switch (parsed.kind) {
    case "not-a-repository":
      return refuse(
        `${name} is not a git repository. Choose the folder a repository was cloned into.`,
      );
    case "bare":
      return refuse(`${name} is a bare repository with no working files. ${ownCheckout}`);
    case "git-dir":
      return refuse(
        "That folder is inside a repository's .git folder. Add the repository's own folder instead.",
      );
    case "untrusted":
      return refuse(`git doesn't trust ${name} because another user owns it.`);
    case "outdated":
      return refuse(
        "Satellite needs git 2.31 or newer to read the folder. Update git, then try again.",
      );
    case "unknown":
      return refuse(`git couldn't read ${name}. Nothing was added.`);
    case "work-tree":
      break;
  }
  if (parsed.linked && (await revParse(parsed.commonDir)).kind === "bare") {
    return refuse(`${name} is a worktree of a bare repository. ${ownCheckout}`);
  }
  if (parsed.linked) {
    return refuse(
      `${name} is a worktree of another repository. Add the repository's main folder instead.`,
    );
  }
  const root = await realFolder(parsed.toplevel);
  if (root === undefined) return refuse(missingFolder);
  if (isInsidePath(read.home, root)) return refuse(ownFolder);
  if (!isInsidePath(root, real)) {
    return refuse(`${name} keeps its working files in another folder. ${ownCheckout}`);
  }
  if (!samePath(root, real)) {
    const rootName = folderName(root);
    return refuse(`${name} is inside the repository ${rootName}. Add ${rootName} itself instead.`);
  }
  const gitFolder = await realFolder(parsed.gitDir);
  if (gitFolder === undefined || !samePath(gitFolder, join(root, ".git"))) {
    return refuse(`${name} uses a .git folder from somewhere else. ${ownGitFolder}`);
  }
  if (
    !(await honoursNoLazyFetch()) &&
    refusesReads(false, await repositoryConfig(root).catch(() => undefined))
  ) {
    return refuse(partialCloneRefusal);
  }
  return { ok: true, root };
}
