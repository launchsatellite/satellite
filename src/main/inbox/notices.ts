import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import type { BridgeOwner } from "../bridge/registry.ts";
import { noticeText, type NoticeSubject, type NoticeText } from "./notice-text.ts";

export interface Needing {
  workspace: WorkspaceRef;
  owner: BridgeOwner;
}
export interface ShownNotice {
  close(): void;
}
export interface NoticesOptions {
  inFront: () => boolean;
  subject: (ref: WorkspaceRef) => Promise<NoticeSubject | undefined>;
  show: (text: NoticeText, onClick: () => void) => ShownNotice | undefined;
  setBadge: (count: number) => void;
  open: (target: Needing) => void;
}
export interface Notices {
  update(needing: readonly Needing[]): void;
  setEnabled(on: boolean): void;
}
interface Named {
  entry: Needing;
  subject: NoticeSubject;
}

export const noticeGapMs = 5000;

function placeKey({ projectId, workspace }: WorkspaceRef): string {
  return `${projectId}/${workspace}`;
}

export function createNotices({ inFront, subject, show, setBadge, open }: NoticesOptions): Notices {
  let enabled = true;
  let needing = new Map<string, Needing>();
  const pending = new Map<string, Needing>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shownAt: number | undefined;
  let shown: { notice: ShownNotice; keys: string[] } | undefined;
  let failureLogged = false;
  const quiet = () => !enabled || inFront();
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const closeShown = () => {
    shown?.notice.close();
    shown = undefined;
  };
  const failed = (error: unknown) => {
    if (failureLogged) return;
    failureLogged = true;
    console.error("Satellite could not show a notification", error);
  };
  const present = async (entries: readonly Needing[]) => {
    const subjects = await Promise.all(entries.map(({ workspace }) => subject(workspace)));
    if (quiet()) return;
    const named = entries.flatMap((entry, index): Named[] => {
      const found = subjects[index];
      return found === undefined || !needing.has(placeKey(entry.workspace))
        ? []
        : [{ entry, subject: found }];
    });
    const [first, ...rest] = named;
    const target = named.at(-1);
    if (first === undefined || target === undefined) return;
    closeShown();
    const notice = show(noticeText([first.subject, ...rest.map(({ subject }) => subject)]), () => {
      open(target.entry);
    });
    if (notice !== undefined) {
      shown = { notice, keys: named.map(({ entry }) => placeKey(entry.workspace)) };
    }
  };
  const flush = () => {
    clearTimer();
    const entries = [...pending.values()];
    pending.clear();
    if (entries.length === 0 || quiet()) return;
    shownAt = Date.now();
    present(entries).catch(failed);
  };
  const schedule = () => {
    if (pending.size === 0 || timer !== undefined) return;
    const wait = shownAt === undefined ? 0 : shownAt + noticeGapMs - Date.now();
    if (wait <= 0) flush();
    else timer = setTimeout(flush, wait);
  };
  return {
    update(list) {
      const next = new Map<string, Needing>();
      for (const entry of list) {
        const key = placeKey(entry.workspace);
        if (!next.has(key)) next.set(key, entry);
      }
      if (next.size !== needing.size) setBadge(next.size);
      const announce = !quiet();
      for (const [key, entry] of next) {
        if (announce && !needing.has(key)) pending.set(key, entry);
      }
      for (const key of pending.keys()) {
        if (!next.has(key)) pending.delete(key);
      }
      needing = next;
      if (shown?.keys.every((key) => !next.has(key))) closeShown();
      schedule();
    },
    setEnabled(on) {
      enabled = on;
      if (on) return;
      pending.clear();
      clearTimer();
    },
  };
}
