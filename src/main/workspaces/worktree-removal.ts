import { relative, sep } from "node:path";
import type { ToolRun } from "../platform/tools.ts";
import { answerWithin } from "../projects/repository-check.ts";
import {
  findLinks,
  linkWalkLimits,
  removeLink,
  type FoundLinks,
  type ReadEntry,
} from "./folder-links.ts";
import { isInsidePath, samePath } from "../platform/paths.ts";
import { runGit, worktreeRemoveMs } from "./git-command.ts";
import { listWorktrees } from "./worktree-list.ts";

export type Why = "unreadable" | "limits" | "late";
export type Boundary =
  { kind: "clear" } | { kind: "mount"; at: string } | { kind: "unchecked"; why: Why };
export type Kept =
  | Exclude<Boundary, { kind: "clear" }>
  | { kind: "link"; at: string }
  | { kind: "worktree"; at: string };
export type Removal =
  | { kind: "kept"; kept: Kept; linksRemoved: number }
  | { kind: "ran"; run: ToolRun | undefined; forced: boolean; linksRemoved: number };
export type Walked =
  Extract<Removal, { kind: "kept" }> | { kind: "walked"; path: string; links: readonly string[] };
interface RemovalOptions {
  force: boolean;
  locked: boolean;
  forceWhenUnclean?: boolean;
  read?: ReadEntry;
}

const placeLimit = 300;
const lateWalk: Extract<Boundary, { kind: "unchecked" }> = { kind: "unchecked", why: "late" };
const uncleanAnswer = "contains modified or untracked files, use --force to delete it";

function placeIn(folder: string, path: string): string {
  return relative(folder, path).split(sep).join("/").slice(0, placeLimit);
}

async function walk(folder: string, read?: ReadEntry): Promise<FoundLinks | "late"> {
  const bounds = {
    entries: linkWalkLimits.entries,
    depth: linkWalkLimits.depth,
    deadline: Date.now() + linkWalkLimits.ms,
  };
  return answerWithin(findLinks(folder, bounds, read), linkWalkLimits.ms);
}

function boundaryOf(folder: string, found: FoundLinks): Boundary {
  if (found.mount !== null) return { kind: "mount", at: placeIn(folder, found.mount) };
  if (found.unchecked !== null) return { kind: "unchecked", why: found.unchecked };
  return { kind: "clear" };
}

export function uncheckedBecause(why: Why): string {
  switch (why) {
    case "unreadable":
      return "Satellite can't read every folder inside it, so it can't rule out a folder from another drive there";
    case "limits":
      return "it holds more than Satellite checks for links and folders from another drive, 1000000 entries, 256 folders deep or 60 seconds";
    case "late":
      return "a folder inside it didn't answer within 60 seconds, so Satellite can't check it for links and folders from another drive";
  }
}

export function uncheckedFix(why: Why, retry: string): string {
  switch (why) {
    case "unreadable":
      return `Make its folders readable, then ${retry}.`;
    case "limits":
      return "Check that it holds no folder from another drive, then remove it with git worktree remove in a terminal.";
    case "late":
      return `Check the drives mounted inside it, then ${retry}.`;
  }
}

export async function boundaryInside(folder: string, read?: ReadEntry): Promise<Boundary> {
  const found = await walk(folder, read);
  return found === "late" ? lateWalk : boundaryOf(folder, found);
}

export async function walkForRemoval(path: string, read?: ReadEntry): Promise<Walked> {
  const found = await walk(path, read);
  if (found === "late") return { kind: "kept", kept: lateWalk, linksRemoved: 0 };
  const boundary = boundaryOf(path, found);
  if (boundary.kind !== "clear") return { kind: "kept", kept: boundary, linksRemoved: 0 };
  return { kind: "walked", path, links: found.links };
}

export function refusedAsUnclean(run: ToolRun | undefined): boolean {
  return run !== undefined && run.exitCode !== 0 && run.stderr.includes(uncleanAnswer);
}

async function heldWorktree(root: string, path: string): Promise<Kept | undefined> {
  const listing = await listWorktrees(root);
  if (listing === undefined) return { kind: "unchecked", why: "unreadable" };
  const held = listing.worktrees.find(
    (worktree) =>
      !worktree.prunable && !samePath(worktree.path, path) && isInsidePath(path, worktree.path),
  );
  return held === undefined ? undefined : { kind: "worktree", at: placeIn(path, held.path) };
}

export async function removeWalked(
  root: string,
  { path, links }: Extract<Walked, { kind: "walked" }>,
  { force, locked, forceWhenUnclean = false }: Omit<RemovalOptions, "read">,
): Promise<Removal> {
  let linksRemoved = 0;
  const heldFirst = await heldWorktree(root, path);
  if (heldFirst !== undefined) return { kind: "kept", kept: heldFirst, linksRemoved };
  for (const link of links) {
    if (!(await removeLink(link))) {
      return { kind: "kept", kept: { kind: "link", at: placeIn(path, link) }, linksRemoved };
    }
    linksRemoved += 1;
  }
  const heldNow = links.length === 0 ? undefined : await heldWorktree(root, path);
  if (heldNow !== undefined) return { kind: "kept", kept: heldNow, linksRemoved };
  const first = locked ? ["--force", "--force"] : force ? ["--force"] : [];
  let forced = first.length > 0;
  let run = await runGit(
    root,
    ["worktree", "remove", ...first, "--end-of-options", path],
    worktreeRemoveMs,
    undefined,
    { filtersOf: path },
  );
  if (!forced && forceWhenUnclean && refusedAsUnclean(run)) {
    const heldLast = await heldWorktree(root, path);
    if (heldLast !== undefined) return { kind: "kept", kept: heldLast, linksRemoved };
    forced = true;
    run = await runGit(
      root,
      ["worktree", "remove", "--force", "--end-of-options", path],
      worktreeRemoveMs,
      undefined,
      { filtersOf: path },
    );
  }
  return { kind: "ran", run, forced, linksRemoved };
}

export async function removeWorktree(
  root: string,
  path: string,
  options: RemovalOptions,
): Promise<Removal> {
  const walked = await walkForRemoval(path, options.read);
  return walked.kind === "kept" ? walked : removeWalked(root, walked, options);
}
