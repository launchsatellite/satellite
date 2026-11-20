import { relative, sep } from "node:path";
import { linkWalkMustFinish } from "../platform/file-system.ts";
import type { ToolRun } from "../platform/tools.ts";
import { findLinks, linkWalkLimits, removeLink, type ReadEntry } from "./folder-links.ts";
import { runGit, worktreeRemoveMs } from "./git-command.ts";

export type Kept =
  { cause: "unchecked" } | { cause: "mount"; at: string } | { cause: "link"; at: string };
export type Removal =
  | { kind: "kept"; kept: Kept; linksRemoved: number }
  | { kind: "ran"; run: ToolRun | undefined; forced: boolean; linksRemoved: number };
interface RemovalOptions {
  force: boolean;
  locked: boolean;
  read?: ReadEntry;
}

const placeLimit = 300;
const uncleanAnswer = "contains modified or untracked files, use --force to delete it";

function walkBounds() {
  return {
    entries: linkWalkLimits.entries,
    depth: linkWalkLimits.depth,
    deadline: Date.now() + linkWalkLimits.ms,
  };
}

function placeIn(folder: string, path: string): string {
  return relative(folder, path).split(sep).join("/").slice(0, placeLimit);
}

export async function mountInside(folder: string, read?: ReadEntry): Promise<string | null> {
  const { mount } = await findLinks(folder, walkBounds(), read);
  return mount === null ? null : placeIn(folder, mount);
}

export async function removeWorktree(
  root: string,
  path: string,
  { force, locked, read }: RemovalOptions,
): Promise<Removal> {
  const found = await findLinks(path, walkBounds(), read);
  if (found.mount !== null) {
    return {
      kind: "kept",
      kept: { cause: "mount", at: placeIn(path, found.mount) },
      linksRemoved: 0,
    };
  }
  if (!found.complete && linkWalkMustFinish()) {
    return { kind: "kept", kept: { cause: "unchecked" }, linksRemoved: 0 };
  }
  let linksRemoved = 0;
  for (const link of found.links) {
    if (!(await removeLink(link))) {
      return { kind: "kept", kept: { cause: "link", at: placeIn(path, link) }, linksRemoved };
    }
    linksRemoved += 1;
  }
  const first = locked ? ["--force", "--force"] : force ? ["--force"] : [];
  let forced = first.length > 0;
  let run = await runGit(
    root,
    ["worktree", "remove", ...first, "--end-of-options", path],
    worktreeRemoveMs,
  );
  if (!forced && run !== undefined && run.exitCode !== 0 && run.stderr.includes(uncleanAnswer)) {
    forced = true;
    run = await runGit(
      root,
      ["worktree", "remove", "--force", "--end-of-options", path],
      worktreeRemoveMs,
    );
  }
  return { kind: "ran", run, forced, linksRemoved };
}
