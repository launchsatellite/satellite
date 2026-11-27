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

const firstRetryMs = 5000;
const lastRetryMs = 300_000;

export function forcedBackend(platform: NodeJS.Platform): "fs-events" | "windows" | "inotify" {
  if (platform === "darwin") return "fs-events";
  if (platform === "win32") return "windows";
  return "inotify";
}

export function retryDelay(failures: number): number {
  return Math.min(lastRetryMs, firstRetryMs * 2 ** Math.max(0, failures - 1));
}

export function plannedRoots(
  projects: readonly WatchedProject[],
  platform: NodeJS.Platform = process.platform,
): Map<string, Set<string>> {
  const folders = projects
    .flatMap((project) =>
      [project.path, ...project.workspaces.map(({ path }) => path)].map((path) => ({
        path,
        id: project.id,
      })),
    )
    .sort((a, b) => a.path.length - b.path.length);
  const roots = new Map<string, Set<string>>();
  for (const { path, id } of folders) {
    const holder = [...roots.keys()].find((root) => isInsidePath(root, path, platform));
    if (holder === undefined) roots.set(path, new Set([id]));
    else roots.get(holder)?.add(id);
  }
  return roots;
}
