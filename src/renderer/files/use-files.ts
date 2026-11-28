import { useEffect, useRef, useState } from "react";
import { isWatched, onWatchedChange } from "../bridge/watch-news.ts";
import {
  filesLimits,
  type BridgeResult,
  type FileRead,
  type FilesList,
  type FolderListing,
  type WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { createSchedule } from "../ui/refresh-schedule.ts";
import { fileSentence, folderSentence } from "./file-words.ts";
import { recallTree, rememberTree } from "./tree-memory.ts";

type ShownRead = Exclude<FileRead, { kind: "same" }>;
type KeptRead = Extract<FileRead, { kind: "text" | "link" }>;
type Listings = ReadonlyMap<string, FolderListing>;

export interface FileShown {
  path: string;
  read: ShownRead;
}

interface Outcome<T> {
  value: T;
  problem: string | null;
}

const cachedReads = 8;
const cachedChars = 8_388_608;
const reads = new Map<string, KeptRead>();
const keptReads = ["text", "link"];
const goodKinds = ["text", "link", "image", "binary", "large", "not-utf8"];
const unsettled = ["hung", "changing"];

function isVisible(): boolean {
  return document.visibilityState === "visible";
}

function readKey(workspace: WorkspaceRef, path: string): string {
  return `${workspace.projectId}/${workspace.workspace}\u0000${path}`;
}

function remember(key: string, read: KeptRead): void {
  reads.delete(key);
  reads.set(key, read);
  let total = [...reads.values()].reduce((sum, kept) => sum + kept.text.length, 0);
  for (const [oldest, kept] of reads) {
    if (reads.size <= 1 || (reads.size <= cachedReads && total <= cachedChars)) break;
    reads.delete(oldest);
    total -= kept.text.length;
  }
}

function keptRead(key: string): KeptRead | undefined {
  const kept = reads.get(key);
  if (kept === undefined) return undefined;
  reads.delete(key);
  reads.set(key, kept);
  return kept;
}

function stampOf(read: FileRead): string | null {
  return "stamp" in read ? read.stamp : null;
}

function isKept(read: ShownRead): read is KeptRead {
  return keptReads.includes(read.kind);
}

export function afterRead(
  current: FileShown | undefined,
  key: string,
  path: string,
  result: BridgeResult<FileRead>,
): Outcome<FileShown | undefined> {
  const good =
    current?.path === path && goodKinds.includes(current.read.kind) ? current : undefined;
  if (!result.ok) {
    return { value: current?.path === path ? current : undefined, problem: result.error.message };
  }
  const read = result.value;
  if (read.kind === "same") {
    if (current?.path === path) return { value: current, problem: null };
    const kept = keptRead(key);
    return { value: kept === undefined ? undefined : { path, read: kept }, problem: null };
  }
  if (unsettled.includes(read.kind) && good !== undefined) {
    return { value: good, problem: fileSentence(read) ?? null };
  }
  if (isKept(read)) remember(key, read);
  else reads.delete(key);
  if (current?.path === path && JSON.stringify(current.read) === JSON.stringify(read)) {
    return { value: current, problem: null };
  }
  return { value: { path, read }, problem: null };
}

export function afterList(
  current: Listings,
  folders: readonly string[],
  result: BridgeResult<FilesList>,
): Outcome<Listings> {
  const answers: [string, FolderListing][] = result.ok
    ? result.value.folders.map(({ path, listing }) => [path, listing])
    : folders.filter((path) => !current.has(path)).map((path) => [path, { state: "failed" }]);
  let next: Map<string, FolderListing> | undefined;
  let problem = result.ok ? null : result.error.message;
  for (const [path, listing] of answers) {
    const before = current.get(path);
    const stale = listing.state === "hung" || listing.state === "failed";
    if (stale && before?.state === "listed") {
      problem ??= folderSentence(listing.state);
      continue;
    }
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(listing)) continue;
    next ??= new Map(current);
    next.set(path, listing);
  }
  if (next === undefined) return { value: current, problem };
  for (const path of next.keys()) {
    if (next.size <= filesLimits.folders) break;
    if (!folders.includes(path)) next.delete(path);
  }
  return { value: next, problem };
}

function isSettled(list: BridgeResult<FilesList>, read: BridgeResult<FileRead> | null): boolean {
  if (!list.ok) return false;
  if (
    list.value.folders.some(({ listing }) => listing.state === "hung" || listing.state === "failed")
  ) {
    return false;
  }
  return read === null || (read.ok && !unsettled.includes(read.value.kind));
}

export function useFiles(
  workspace: WorkspaceRef | null,
  folders: readonly string[],
  active: string | undefined,
  finished: string,
): {
  listings: Listings;
  file: FileShown | undefined;
  listError: string | null;
  fileError: string | null;
} {
  const [listings, setListings] = useState<Listings>(() =>
    workspace === null ? new Map() : recallTree(workspace).listings,
  );
  const [shown, setShown] = useState<FileShown>();
  const [listProblem, setListProblem] = useState<string | null>(null);
  const [fileProblem, setFileProblem] = useState<{ path: string; text: string } | null>(null);
  const latest = useRef({ folders, active, shown, listings });
  const refresh = useRef<() => void>(() => undefined);
  const seen = useRef({ asked: "", finished });
  const projectId = workspace?.projectId;
  const key = workspace?.workspace;
  const asked = `${folders.join("\u0000")}\u0001${active ?? ""}`;

  useEffect(() => {
    if (projectId !== undefined && key !== undefined) {
      rememberTree({ projectId, workspace: key }, { listings });
    }
  }, [projectId, key, listings]);

  useEffect(() => {
    latest.current = { folders, active, shown, listings };
  });

  useEffect(() => {
    if (projectId === undefined || key === undefined) return;
    let stopped = false;
    const here = { projectId, workspace: key };
    const schedule = createSchedule({
      visible: isVisible,
      focused: () => document.hasFocus(),
      watched: () => isWatched([projectId]),
      now: () => performance.now(),
      after: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => {
          clearTimeout(timer);
        };
      },
      read: async () => {
        const { folders: open, active: path, shown: current } = latest.current;
        const known =
          path === undefined
            ? null
            : current?.path === path
              ? stampOf(current.read)
              : (keptRead(readKey(here, path))?.stamp ?? null);
        const [list, read] = await Promise.all([
          invoke("files.list", { workspace: here, folders: [...open] }),
          path === undefined
            ? Promise.resolve(null)
            : invoke("files.read", { workspace: here, path, known }),
        ]);
        if (!stopped) {
          const after = afterList(latest.current.listings, open, list);
          latest.current.listings = after.value;
          setListings(after.value);
          setListProblem(after.problem);
          if (path !== undefined && read !== null && path === latest.current.active) {
            const outcome = afterRead(latest.current.shown, readKey(here, path), path, read);
            latest.current.shown = outcome.value;
            setShown(outcome.value);
            setFileProblem(outcome.problem === null ? null : { path, text: outcome.problem });
          }
        }
        const readState =
          read === null ? "" : read.ok ? (stampOf(read.value) ?? read.value.kind) : "failed";
        return {
          files: isSettled(list, read),
          key: JSON.stringify([list, readState === "same" ? known : readState]),
        };
      },
    });
    const onVisibility = () => {
      if (isVisible()) schedule.refresh();
      else schedule.hide();
    };
    refresh.current = schedule.refresh;
    window.addEventListener("focus", schedule.refresh);
    document.addEventListener("visibilitychange", onVisibility);
    schedule.start();
    const unwatch = onWatchedChange((changed) => {
      if (changed.has(projectId)) schedule.nudge();
    });
    return () => {
      stopped = true;
      unwatch();
      schedule.stop();
      refresh.current = () => undefined;
      window.removeEventListener("focus", schedule.refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [projectId, key]);

  useEffect(() => {
    const before = seen.current;
    seen.current = { asked, finished };
    if (before.asked !== "" && before.asked !== asked) refresh.current();
    else if (before.finished !== finished && finished !== "") refresh.current();
  }, [asked, finished]);

  const kept =
    active === undefined || workspace === null ? undefined : keptRead(readKey(workspace, active));
  const file =
    shown?.path === active
      ? shown
      : active === undefined || kept === undefined
        ? undefined
        : { path: active, read: kept };
  const fileError = fileProblem !== null && fileProblem.path === active ? fileProblem.text : null;
  return { listings, file, listError: listProblem, fileError };
}
