import { posix, win32 } from "node:path";
import { isInsidePath } from "../platform/paths.ts";

export type WatcherNews =
  | { kind: "watching"; root: string }
  | { kind: "changed"; root: string }
  | { kind: "error"; root: string };

interface WatchedProject {
  id: string;
  path: string;
  workspaces: readonly { path: string }[];
}

export const ignoredInRoot = [".git/objects", ".git/lfs", "node_modules"];

const ignoreLimit = 200;
const patternLike = /[*?[\]{}()!+@]/;

export function splitIgnores(ignore: readonly string[]): { native: string[]; literal: string[] } {
  return {
    native: ignore.filter((each) => !patternLike.test(each)),
    literal: ignore.filter((each) => patternLike.test(each)),
  };
}

export function isIgnoredLiterally(
  root: string,
  path: string,
  literal: readonly string[],
  platform: NodeJS.Platform = process.platform,
): boolean {
  const paths = platform === "win32" ? win32 : posix;
  return literal.some((each) => isInsidePath(paths.join(root, each), path, platform));
}
const firstRetryMs = 5000;

export const steadyMs = 60_000;
const lastRetryMs = 300_000;

export function forcedBackend(
  platform: NodeJS.Platform,
): "fs-events" | "windows" | "inotify" | undefined {
  if (platform === "darwin") return "fs-events";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "inotify";
  return undefined;
}

export function retryDelay(failures: number): number {
  return Math.min(lastRetryMs, firstRetryMs * 2 ** Math.max(0, failures - 1));
}

export interface PlannedRoot {
  ids: Set<string>;
  ignore: string[];
}

export function plannedRoots(
  projects: readonly WatchedProject[],
  platform: NodeJS.Platform = process.platform,
): Map<string, PlannedRoot> {
  const paths = platform === "win32" ? win32 : posix;
  const folders = projects
    .flatMap((project) =>
      [project.path, ...project.workspaces.map(({ path }) => path)].map((path) => ({
        path,
        id: project.id,
      })),
    )
    .sort((a, b) => a.path.length - b.path.length);
  const roots = new Map<string, PlannedRoot>();
  for (const { path, id } of folders) {
    const holder = [...roots.keys()].find((root) => isInsidePath(root, path, platform));
    if (holder === undefined) {
      roots.set(path, {
        ids: new Set([id]),
        ignore: ignoredInRoot.map((each) => paths.join(each)),
      });
      continue;
    }
    const planned = roots.get(holder);
    if (planned === undefined) continue;
    planned.ids.add(id);
    const inside = paths.relative(holder, path);
    for (const each of ignoredInRoot) {
      const ignored = inside === "" ? paths.join(each) : paths.join(inside, each);
      if (!planned.ignore.includes(ignored) && planned.ignore.length < ignoreLimit) {
        planned.ignore.push(ignored);
      }
    }
  }
  return roots;
}
