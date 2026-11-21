import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProcessRow, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { createSchedule, type Pace } from "../ui/refresh-schedule.ts";
import type { Notify } from "../ui/toast.tsx";

export interface Processes {
  rowsOf: (ref: WorkspaceRef) => readonly ProcessRow[];
  moreOf: (ref: WorkspaceRef) => number;
  stopping: ReadonlySet<string>;
  problem: string | null;
  refresh: () => void;
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
  more: ProcessesMore;
  key: string;
}

const pace: Pace = { firstMs: 10_000, maxMs: 30_000, factor: 4 };
const nothing: Shown = { rows: [], more: [], key: "" };

export function stopKey(row: ProcessRow): string {
  return `${String(row.pid)}/${String(row.started)}`;
}

function isVisible(): boolean {
  return document.visibilityState === "visible";
}

function shownKey(rows: readonly ProcessRow[], more: ProcessesMore): string {
  return JSON.stringify([rows, more]);
}

export function useProcesses({ live, finished, notify }: ProcessesInput): Processes {
  const [shown, setShown] = useState<Shown>(nothing);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [ended, setEnded] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const refreshNow = useRef<() => void>(() => undefined);
  const endedAt = useRef(new Map<string, number>());
  const previous = useRef({ live, finished });
  const running = live !== "";

  if (!running && shown !== nothing) setShown(nothing);
  if (!running && ended.size > 0) setEnded(new Set());
  if (!running && problem !== null) setProblem(null);
  if (!running && readProblem !== null) setReadProblem(null);

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
          const began = performance.now();
          const result = await invoke("processes.list", {});
          if (!result.ok) {
            if (!stopped) setReadProblem(result.error.message);
            return { files: false, key: "" };
          }
          const { rows, more } = result.value;
          if (!stopped) {
            setReadProblem(null);
            const listed = new Set(rows.map(stopKey));
            setEnded((current) => {
              const back = [...current].filter(
                (key) => listed.has(key) && (endedAt.current.get(key) ?? Infinity) < began,
              );
              if (back.length === 0) return current;
              const next = new Set(current);
              for (const key of back) next.delete(key);
              return next;
            });
            const key = shownKey(rows, more);
            setShown((current) => (current.key === key ? current : { rows, more, key }));
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
          liveIds.has(row.session) &&
          !ended.has(stopKey(row)),
      ),
    [shown.rows, liveIds, ended],
  );

  const stop = useCallback(
    (row: ProcessRow) => {
      const key = stopKey(row);
      setProblem(null);
      setStopping((current) => new Set(current).add(key));
      void invoke("processes.stop", { pid: row.pid, started: row.started }).then((result) => {
        if (result.ok || result.error.code === "not-found") {
          endedAt.current.set(key, performance.now());
          setEnded((current) => new Set(current).add(key));
        } else {
          setProblem(result.error.message);
          notify(result.error.message, "error");
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

  const refresh = useCallback(() => {
    refreshNow.current();
  }, []);

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

  return {
    rowsOf,
    moreOf,
    stopping,
    problem: problem ?? readProblem,
    refresh,
    stop,
  };
}
