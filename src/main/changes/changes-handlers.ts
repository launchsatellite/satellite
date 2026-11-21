import type {
  ChangedFile,
  ChangesList,
  ChangesView,
  FileSides,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers, type BridgeOwner } from "../bridge/registry.ts";
import { isInsidePath, samePath } from "../platform/paths.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import { sessionFolder } from "../sessions/session-folder.ts";
import { countUnpushed, hasRemote, readTracking } from "../workspaces/branch-tracking.ts";
import { currentBranch, headOid, mergeBase, resolveBase } from "./change-base.ts";
import { readChangeList, type ChangeRecord } from "./change-list.ts";
import { readBlobSide, readWorktreeSide, type SideRead } from "./file-sides.ts";
import { createReadQueue } from "./read-queue.ts";

export interface Changes {
  handlers: Pick<BridgeHandlers, "changes.list" | "changes.file">;
  stopInside(folder: string): Promise<void>;
}
interface ActiveRead {
  controller: AbortController;
  folder: string | undefined;
  done: Promise<unknown>;
}
interface ListRead {
  controller: AbortController;
  answer: Promise<ChangesList>;
}
interface CachedList {
  folder: string;
  records: Map<string, ChangeRecord>;
  chars: number;
}
interface PageReads {
  lists: Map<string, ListRead>;
  file: AbortController | undefined;
  cache: Map<string, CachedList>;
}
type Unavailable = Extract<ChangesList["changes"], { kind: "unavailable" }>["reason"];
type Header = Omit<ChangesList, "changes">;

export const changesReadSlots = 4;
export const changesStopWaitMs = 5000;

const changesQueued = 16;
const cachedLists = 8;
const cachedChars = 8_388_608;
const recordChars = 200;
const nameLimit = 255;
const shortOidLength = 7;
const changesSentences = {
  gone: "That workspace's folder is gone, so Satellite can't show its changes.",
  archiving: "Satellite is archiving that workspace, so its changes can't be read.",
};
const notListedSentence =
  "That file is no longer in the list of changes. The list refreshes in a moment.";
const movedOnSentence = "Satellite moved on to a newer read.";
const emptyText: SideRead = { kind: "text", text: "" };

function notListed(): BridgeFailure {
  return new BridgeFailure("not-found", notListedSentence);
}

function movedOn(): BridgeFailure {
  return new BridgeFailure("refused", movedOnSentence);
}

function keyOf(ref: WorkspaceRef, view: ChangesView): string {
  return `${ref.projectId}/${ref.workspace}/${view}`;
}

function shortName(name: string | null | undefined): string | null {
  return name === null || name === undefined || name === "" ? null : name.slice(0, nameLimit);
}

function shortOid(oid: string | null): string | null {
  return oid === null ? null : oid.slice(0, shortOidLength);
}

function listedFile(record: ChangeRecord): ChangedFile {
  const { path, from, letter, tracked, kind, added, removed, stamp } = record;
  return { path, from, letter, tracked, kind, added, removed, stamp };
}

function cachedList(folder: string, records: readonly ChangeRecord[]): CachedList {
  const chars = records.reduce(
    (total, record) => total + record.path.length + (record.from?.length ?? 0) + recordChars,
    0,
  );
  return { folder, records: new Map(records.map((record) => [record.path, record])), chars };
}

function remember(page: PageReads, key: string, list: CachedList): void {
  page.cache.delete(key);
  page.cache.set(key, list);
  let chars = [...page.cache.values()].reduce((total, cached) => total + cached.chars, 0);
  for (const [oldest, cached] of page.cache) {
    if (page.cache.size <= 1 || (page.cache.size <= cachedLists && chars <= cachedChars)) break;
    page.cache.delete(oldest);
    chars -= cached.chars;
  }
}

async function tracking(root: string, branch: string | null, signal: AbortSignal) {
  const none = { ahead: null, behind: null };
  if (branch === null) return none;
  signal.throwIfAborted();
  const track = (await readTracking(root, [branch])).get(branch);
  if (track !== null) return { ahead: track?.ahead ?? null, behind: track?.behind ?? null };
  signal.throwIfAborted();
  if ((await hasRemote(root)) !== true) return none;
  signal.throwIfAborted();
  return { ahead: await countUnpushed(root, branch), behind: null };
}

function sidesOf(original: SideRead, modified: SideRead): FileSides {
  if (original.kind === "refused" || modified.kind === "refused") throw notListed();
  if (original.kind === "text" && modified.kind === "text") {
    return { kind: "text", original: original.text, modified: modified.text };
  }
  const shown = original.kind === "text" ? modified : original;
  if (shown.kind === "text" || shown.kind === "gone") return { kind: "changing" };
  return { kind: shown.kind };
}

async function fileSides(
  folder: string,
  record: ChangeRecord,
  signal: AbortSignal,
): Promise<FileSides> {
  if (record.path.includes("�")) return { kind: "unreadable" };
  if (record.kind === "repository") return { kind: "repository" };
  if (record.kind === "binary") return { kind: "binary" };
  if (record.kind === "submodule") {
    const movedInWorktree = record.targetOid === null && record.letter !== "D";
    if (movedInWorktree) return { kind: "submodule", from: null, to: null };
    return { kind: "submodule", from: shortOid(record.sourceOid), to: shortOid(record.targetOid) };
  }
  if (record.letter === "U") return { kind: "unmerged" };
  const { sourceOid } = record;
  const [original, modified] = await Promise.all([
    record.letter === "A" || sourceOid === null
      ? emptyText
      : readBlobSide(folder, sourceOid, signal),
    record.letter === "D" ? emptyText : readWorktreeSide(folder, record.path),
  ]);
  return sidesOf(original, modified);
}

export function createChanges({ home, store }: { home: string; store: ProjectStore }): Changes {
  const inSlot = createReadQueue(changesReadSlots, changesQueued);
  const pages = new WeakMap<BridgeOwner, PageReads>();
  const active = new Set<ActiveRead>();

  const pageOf = (owner: BridgeOwner): PageReads => {
    const known = pages.get(owner);
    if (known !== undefined) return known;
    const page: PageReads = { lists: new Map(), file: undefined, cache: new Map() };
    pages.set(owner, page);
    owner.onGone(() => {
      for (const read of page.lists.values()) read.controller.abort(movedOn());
      page.file?.abort(movedOn());
      page.lists.clear();
      page.cache.clear();
      pages.delete(owner);
    });
    return page;
  };

  const owned = <T>(
    controller: AbortController,
    folder: string | undefined,
    work: (read: ActiveRead) => Promise<T>,
  ): Promise<T> => {
    const read: ActiveRead = { controller, folder, done: Promise.resolve() };
    active.add(read);
    const answer = inSlot(controller.signal, async () => {
      const value = await work(read);
      controller.signal.throwIfAborted();
      return value;
    }).finally(() => {
      active.delete(read);
    });
    read.done = answer.catch(() => undefined);
    return answer;
  };

  const readList = async (
    ref: WorkspaceRef,
    view: ChangesView,
    signal: AbortSignal,
    read: ActiveRead,
  ): Promise<{ answer: ChangesList; cached?: CachedList }> => {
    const folder = await sessionFolder(home, store, ref, changesSentences);
    read.folder = folder;
    signal.throwIfAborted();
    const project = await store.project(ref.projectId);
    signal.throwIfAborted();
    const [head, branch, lookup] = await Promise.all([
      headOid(folder, signal),
      currentBranch(folder, signal),
      resolveBase(project.path, folder, signal),
    ]);
    signal.throwIfAborted();
    const base = lookup.kind === "base" ? lookup.base : null;
    const header: Header = {
      branch: shortName(branch),
      base: shortName(base?.name),
      ...(await tracking(project.path, branch ?? null, signal)),
      conflict: null,
    };
    const unavailable = (reason: Unavailable): { answer: ChangesList } => ({
      answer: { ...header, changes: { kind: "unavailable", reason } },
    });
    if (head === undefined) return unavailable("failed");
    if (head === null) return unavailable("no-commits");
    let compareWith = head;
    if (view === "branch") {
      if (lookup.kind === "failed") return unavailable("failed");
      if (base === null) return unavailable("no-base");
      signal.throwIfAborted();
      const fork = await mergeBase(folder, head, base.oid, signal);
      if (fork === null) return unavailable("unrelated");
      if (fork === undefined) return unavailable("failed");
      compareWith = fork;
    }
    signal.throwIfAborted();
    const list = await readChangeList(folder, compareWith, signal);
    if (list.kind === "unavailable") return unavailable(list.reason);
    return {
      answer: {
        ...header,
        changes: {
          kind: "files",
          files: list.records.map(listedFile),
          more: list.more,
          longPaths: list.longPaths,
        },
      },
      cached: cachedList(folder, list.records),
    };
  };

  return {
    handlers: {
      "changes.list": ({ workspace, view }, owner) => {
        const page = pageOf(owner);
        const key = keyOf(workspace, view);
        const running = page.lists.get(key);
        if (running !== undefined) return running.answer;
        for (const read of page.lists.values()) read.controller.abort(movedOn());
        page.lists.clear();
        const controller = new AbortController();
        const answer = owned(controller, undefined, async (read) => {
          const { answer: listed, cached } = await readList(
            workspace,
            view,
            controller.signal,
            read,
          );
          controller.signal.throwIfAborted();
          if (cached === undefined) page.cache.delete(key);
          else remember(page, key, cached);
          return listed;
        }).finally(() => {
          if (page.lists.get(key)?.controller === controller) page.lists.delete(key);
        });
        page.lists.set(key, { controller, answer });
        return answer;
      },
      "changes.file": async ({ workspace, view, path }, owner) => {
        const page = pageOf(owner);
        page.file?.abort(movedOn());
        const controller = new AbortController();
        page.file = controller;
        try {
          const cached = page.cache.get(keyOf(workspace, view));
          const record = cached?.records.get(path);
          if (cached === undefined || record === undefined) throw notListed();
          return await owned(controller, cached.folder, async () => {
            const folder = await sessionFolder(home, store, workspace, changesSentences);
            if (!samePath(folder, cached.folder)) throw notListed();
            controller.signal.throwIfAborted();
            return fileSides(folder, record, controller.signal);
          });
        } finally {
          if (page.file === controller) page.file = undefined;
        }
      },
    },
    async stopInside(folder) {
      const stopping = [...active].filter(
        (read) => read.folder !== undefined && isInsidePath(folder, read.folder),
      );
      for (const read of stopping) {
        read.controller.abort(new BridgeFailure("not-found", changesSentences.gone));
      }
      let timer: NodeJS.Timeout | undefined;
      const bound = new Promise<void>((settle) => {
        timer = setTimeout(settle, changesStopWaitMs);
      });
      try {
        await Promise.race([Promise.all(stopping.map((read) => read.done)), bound]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
