import type { FilesFind, FilesList, FileRead, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { movedOn, waitForReads, type ActiveRead } from "../changes/changes-handlers.ts";
import { createReadQueue } from "../changes/read-queue.ts";
import { BridgeFailure, type BridgeHandlers, type BridgeOwner } from "../bridge/registry.ts";
import { isInsidePath } from "../platform/paths.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import { sessionFolder } from "../sessions/session-folder.ts";
import { readFileForViewing } from "./file-read.ts";
import { listFolders } from "./folder-listing.ts";
import { rankReadable, readNames } from "./name-index.ts";

export interface Files {
  handlers: Pick<BridgeHandlers, "files.list" | "files.read" | "files.find">;
  stopInside(folder: string): Promise<void>;
  stopAll(): Promise<void>;
}
interface Names {
  folder: string;
  at: number;
  names: string[];
}
interface PageReads {
  list: AbortController | undefined;
  read: AbortController | undefined;
  find: AbortController | undefined;
  names: Names | undefined;
}

const filesReadSlots = 4;
const filesQueued = 16;
export const nameIndexMs = 5000;

const filesSentences = {
  gone: "That workspace's folder is gone, so Satellite can't show its files.",
  archiving: "Satellite is archiving that workspace, so its files can't be read.",
};
const queueFull = "Satellite is reading a lot of files at once. It tries again in a moment.";

function replaced(
  page: PageReads,
  kind: "list" | "read" | "find",
  controller: AbortController,
): void {
  page[kind]?.abort(movedOn());
  page[kind] = controller;
}

export function createFiles({ home, store }: { home: string; store: ProjectStore }): Files {
  const inSlot = createReadQueue(filesReadSlots, filesQueued, queueFull);
  const pages = new WeakMap<BridgeOwner, PageReads>();
  const active = new Set<ActiveRead>();

  const pageOf = (owner: BridgeOwner): PageReads => {
    const known = pages.get(owner);
    if (known !== undefined) return known;
    const page: PageReads = { list: undefined, read: undefined, find: undefined, names: undefined };
    pages.set(owner, page);
    owner.onGone(() => {
      page.list?.abort(movedOn());
      page.read?.abort(movedOn());
      page.find?.abort(movedOn());
      page.names = undefined;
      pages.delete(owner);
    });
    return page;
  };

  const owned = <T>(
    page: PageReads,
    kind: "list" | "read" | "find",
    workspace: WorkspaceRef,
    work: (folder: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    replaced(page, kind, controller);
    const read: ActiveRead = { controller, folder: undefined, done: Promise.resolve() };
    active.add(read);
    const answer = inSlot(controller.signal, async () => {
      const folder = await sessionFolder(home, store, workspace, filesSentences);
      read.folder = folder;
      controller.signal.throwIfAborted();
      const value = await work(folder, controller.signal);
      controller.signal.throwIfAborted();
      return value;
    }).finally(() => {
      active.delete(read);
      if (page[kind] === controller) page[kind] = undefined;
    });
    read.done = answer.catch(() => undefined);
    return answer;
  };

  const listed = async (
    folders: readonly string[],
    folder: string,
    signal: AbortSignal,
  ): Promise<FilesList> => {
    const unique = [...new Set(folders)];
    const listings = await listFolders(folder, unique, signal);
    return {
      folders: unique.map((path, at) => ({ path, listing: listings[at] ?? { state: "failed" } })),
    };
  };

  const found = async (
    page: PageReads,
    folder: string,
    query: string,
    signal: AbortSignal,
  ): Promise<FilesFind> => {
    const cached = page.names;
    if (cached?.folder === folder && Date.now() - cached.at < nameIndexMs) {
      return { kind: "found", paths: await rankReadable(folder, query, cached.names, signal) };
    }
    const index = await readNames(folder, signal);
    signal.throwIfAborted();
    if (index.kind !== "names") {
      page.names = undefined;
      return { kind: index.kind };
    }
    page.names = { folder, at: Date.now(), names: index.names };
    return { kind: "found", paths: await rankReadable(folder, query, index.names, signal) };
  };

  return {
    handlers: {
      "files.list": ({ workspace, folders }, owner) =>
        owned(pageOf(owner), "list", workspace, (folder, signal) =>
          listed(folders, folder, signal),
        ),
      "files.read": ({ workspace, path, known }, owner): Promise<FileRead> =>
        owned(pageOf(owner), "read", workspace, (folder, signal) =>
          readFileForViewing(folder, path, known, signal),
        ),
      "files.find": ({ workspace, query }, owner) => {
        const page = pageOf(owner);
        return owned(page, "find", workspace, (folder, signal) =>
          found(page, folder, query, signal),
        );
      },
    },
    async stopAll() {
      const stopping = [...active];
      for (const read of stopping) read.controller.abort(movedOn());
      await waitForReads(stopping);
    },
    async stopInside(folder) {
      const stopping = [...active].filter(
        (read) => read.folder !== undefined && isInsidePath(folder, read.folder),
      );
      for (const read of stopping) {
        read.controller.abort(new BridgeFailure("not-found", filesSentences.gone));
      }
      await waitForReads(stopping);
    },
  };
}
