import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProcessRow, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { createSchedule, type Pace } from "../ui/refresh-schedule.ts";
import type { Notify } from "../ui/toast.tsx";
import { ageReadout } from "./process-words.ts";

export interface Processes {
  rowsOf: (ref: WorkspaceRef) => readonly ProcessRow[];
  at: number;
  moreOf: (ref: WorkspaceRef) => number;
  stopping: ReadonlySet<string>;
  stop: (row: ProcessRow) => void;
}
interface ProcessesInput {
  live: string;
  finished: string;
  notify: Notify;
}
type ProcessesMore = readonly { workspace: WorkspaceRef; count: number }[];
interface Shown {
  rows: readonly ProcessRow[];
  at: number;
  more: ProcessesMore;
  key: string;
}

const pace: Pace = { firstMs: 10_000, maxMs: 30_000, factor: 4 };
const nothing: Shown = { rows: [], at: 0, more: [], key: "" };

export function stopKey(row: ProcessRow): string {
  return `${String(row.pid)}/${String(row.started)}`;
}

function isVisible(): boolean {
  return document.visibilityState === "visible";
}

function shownKey(rows: readonly ProcessRow[], at: number, more: ProcessesMore): string {
  return JSON.stringify([rows, rows.map((row) => ageReadout(at - row.started)), more]);
}

export function useProcesses({ live, finished, notify }: ProcessesInput): Processes {
  const [shown, setShown] = useState<Shown>(nothing);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const refreshNow = useRef<() => void>(() => undefined);
  const previous = useRef({ live, finished });
  const running = live !== "";

  if (!running && shown !== nothing) setShown(nothing);

  useEffect(() => {
    if (!running) {
      refreshNow.current = () => undefined;
      return;
    }
    let stopped = false;
    const schedule = createSchedule(
      {
        visible: isVisible,
        now: () => performance.now(),
        after: (ms, run) => {
          const timer = setTimeout(run, ms);
          return () => {
            clearTimeout(timer);
          };
        },
        read: async () => {
          const result = await invoke("processes.list", {});
          if (!result.ok) return { files: false, key: "" };
          const { rows, at, more } = result.value;
          if (!stopped) {
            const key = shownKey(rows, at, more);
            setShown((current) => (current.key === key ? current : { rows, at, more, key }));
          }
          return {
            files: true,
            key: JSON.stringify(rows.map(({ pid, started, ports }) => [pid, started, ports])),
          };
        },
      },
      pace,
    );
    const onVisibility = () => {
      if (isVisible()) schedule.refresh();
      else schedule.hide();
    };
    refreshNow.current = schedule.refresh;
    document.addEventListener("visibilitychange", onVisibility);
    schedule.start();
    return () => {
      stopped = true;
      refreshNow.current = () => undefined;
      document.removeEventListener("visibilitychange", onVisibility);
      schedule.stop();
    };
  }, [running]);

  useEffect(() => {
    const before = previous.current;
    previous.current = { live, finished };
    if (before.live === "" || live === "") return;
    if (before.live !== live || before.finished !== finished) refreshNow.current();
  }, [live, finished]);

  const liveIds = useMemo(() => new Set(live.split(" ").filter((id) => id !== "")), [live]);
  const rowsOf = useCallback(
    (ref: WorkspaceRef) =>
      shown.rows.filter(
        (row) =>
          row.workspace.projectId === ref.projectId &&
          row.workspace.workspace === ref.workspace &&
          liveIds.has(row.session),
      ),
    [shown.rows, liveIds],
  );

  const stop = useCallback(
    (row: ProcessRow) => {
      const key = stopKey(row);
      setStopping((current) => new Set(current).add(key));
      void invoke("processes.stop", { pid: row.pid, started: row.started }).then((result) => {
        if (!result.ok) {
          notify(result.error.message, result.error.code === "not-found" ? "info" : "error");
        }
        setStopping((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        refreshNow.current();
      });
    },
    [notify],
  );

  const moreOf = useCallback(
    (ref: WorkspaceRef) =>
      shown.more
        .filter(
          ({ workspace }) =>
            workspace.projectId === ref.projectId && workspace.workspace === ref.workspace,
        )
        .reduce((total, { count }) => total + count, 0),
    [shown.more],
  );

  return { rowsOf, at: shown.at, moreOf, stopping, stop };
}
