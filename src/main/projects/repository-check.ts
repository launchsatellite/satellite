import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, sep } from "node:path";
import { BridgeFailure } from "../bridge/registry.ts";
import { samePath } from "../platform/paths.ts";
import { runTool, type ToolRun } from "../platform/tools.ts";

export type RevParse =
  | { kind: "work-tree"; toplevel: string; linked: boolean }
  | { kind: "bare" }
  | { kind: "git-dir" }
  | { kind: "not-a-repository" }
  | { kind: "untrusted" }
  | { kind: "unknown" };
export type RepositoryCheck = { ok: true; root: string } | { ok: false; refusal: string };

export const gitReadTimeoutMs = 5000;
export const gitReadFlags = ["-c", "core.fsmonitor=false"];

const revParseArgs = [
  "rev-parse",
  "--path-format=absolute",
  "--is-bare-repository",
  "--is-inside-git-dir",
  "--git-dir",
  "--git-common-dir",
  "--show-toplevel",
];
const missingFolder = "That folder no longer exists. Choose another one.";

async function realFolder(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

function isInside(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return fromParent !== ".." && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent);
}

async function revParse(folder: string): Promise<RevParse> {
  let run: ToolRun | undefined;
  try {
    run = await runTool("git", ["-C", folder, ...gitReadFlags, ...revParseArgs], {
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

export function parseRevParse(run: ToolRun): RevParse {
  const lines = run.stdout.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const [bare, insideGitDir, gitDir, commonDir, toplevel] = lines;
  if (bare === "true") return { kind: "bare" };
  if (insideGitDir === "true") return { kind: "git-dir" };
  if (
    run.exitCode === 0 &&
    lines.length === 5 &&
    gitDir !== undefined &&
    commonDir !== undefined &&
    toplevel !== undefined
  ) {
    return { kind: "work-tree", toplevel, linked: !samePath(gitDir, commonDir) };
  }
  if (run.stderr.includes("dubious ownership")) return { kind: "untrusted" };
  if (run.stderr.includes("not a git repository")) return { kind: "not-a-repository" };
  return { kind: "unknown" };
}

export async function checkRepository(folder: string, home: string): Promise<RepositoryCheck> {
  const real = isAbsolute(folder) ? await realFolder(folder) : undefined;
  if (real === undefined) return refuse(missingFolder);
  const isFolder = await stat(real).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
  if (!isFolder) return refuse("Drop a folder, not a file.");
  if (isInside((await realFolder(home)) ?? home, real)) {
    return refuse("That folder belongs to Satellite itself. Add a repository from somewhere else.");
  }
  const name = basename(real);
  const parsed = await revParse(real);
  switch (parsed.kind) {
    case "not-a-repository":
      return refuse(
        `${name} is not a git repository. Choose the folder a repository was cloned into.`,
      );
    case "bare":
      return refuse(
        `${name} is a bare repository with no working files. Add a folder with a checkout instead.`,
      );
    case "git-dir":
      return refuse(
        "That folder is inside a repository's .git folder. Add the repository's own folder instead.",
      );
    case "untrusted":
      return refuse(`git doesn't trust ${name} because another user owns it.`);
    case "unknown":
      return refuse(`git couldn't read ${name}. Nothing was added.`);
    case "work-tree":
      break;
  }
  if (parsed.linked) {
    return refuse(
      `${name} is a worktree of another repository. Add the repository's main folder instead.`,
    );
  }
  if (!samePath(parsed.toplevel, real)) {
    const root = basename(parsed.toplevel);
    return refuse(`${name} is inside the repository ${root}. Add ${root} itself instead.`);
  }
  const root = await realFolder(parsed.toplevel);
  return root === undefined ? refuse(missingFolder) : { ok: true, root };
}
