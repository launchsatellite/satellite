import { useEffect, useRef, useState } from "react";
import { isWatched, onWatchedChange } from "../bridge/watch-news.ts";
import type {
  BridgeResult,
  ChangesList,
  ChangesView,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { createSchedule } from "../ui/refresh-schedule.ts";
import { unavailableSentence } from "./change-words.ts";

interface Header {
  workspace: string;
  base: string | null;
  ahead: number | null;
  behind: number | null;
}

interface ListedPlace {
  place: string;
  list: ChangesList | undefined;
  error: string | null;
}

const transientReasons = new Set(["hung", "failed"]);

function isVisible(): boolean {
  return document.visibilityState === "visible";
}

function answered(current: ListedPlace | null, place: string, result: BridgeResult<ChangesList>) {
  const kept = current?.place === place ? current : null;
  const shown = kept?.list;
  if (!result.ok) return { place, list: shown, error: result.error.message };
  const { changes } = result.value;
  if (
    changes.kind === "unavailable" &&
    transientReasons.has(changes.reason) &&
    shown?.changes.kind === "files"
  ) {
    return { place, list: shown, error: unavailableSentence(changes.reason, shown.base) };
  }
  return { place, list: result.value, error: null };
}

function settled(current: ListedPlace | null, next: ListedPlace): ListedPlace {
  if (current?.place !== next.place || current.error !== next.error) return next;
  if (current.list === next.list) return current;
  return JSON.stringify(current.list) === JSON.stringify(next.list) ? current : next;
}

function sameHeader(current: Header | null, next: Header): boolean {
  return (
    current?.workspace === next.workspace &&
    current.base === next.base &&
    current.ahead === next.ahead &&
    current.behind === next.behind
  );
}

export function changesPlace(workspace: WorkspaceRef, view: ChangesView): string {
  return `${workspace.projectId}/${workspace.workspace}/${view}`;
}

export function useChanges(
  workspace: WorkspaceRef | null,
  view: ChangesView,
  finished: string,
  selected: string | undefined,
): { list: ChangesList | undefined; error: string | null; header: Header | undefined } {
  const [listed, setListed] = useState<ListedPlace | null>(null);
  const [header, setHeader] = useState<Header | null>(null);
  const refresh = useRef<() => void>(() => undefined);
  const calm = useRef<() => void>(() => undefined);
  const seen = useRef<{ place: string | null; finished: string }>({ place: null, finished });
  const projectId = workspace?.projectId;
  const key = workspace?.workspace;
  const place = workspace === null ? null : changesPlace(workspace, view);
  const here = workspace === null ? null : `${workspace.projectId}/${workspace.workspace}`;
  const [askedPlace, setAskedPlace] = useState(place);
  if (askedPlace !== place) {
    setAskedPlace(place);
    setListed(null);
  }

  useEffect(() => {
    if (projectId === undefined || key === undefined || place === null) return;
    let stopped = false;
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
        const result = await invoke("changes.list", {
          workspace: { projectId, workspace: key },
          view,
        });
        if (!stopped) {
          setListed((current) => settled(current, answered(current, place, result)));
          if (result.ok) {
            const { base, ahead, behind } = result.value;
            const next = { workspace: `${projectId}/${key}`, base, ahead, behind };
            setHeader((current) => (sameHeader(current, next) ? current : next));
          }
        }
        return {
          files: result.ok && result.value.changes.kind === "files",
          key: JSON.stringify(result),
        };
      },
    });
    const onVisibility = () => {
      if (isVisible()) schedule.refresh();
      else schedule.hide();
    };
    refresh.current = schedule.refresh;
    calm.current = schedule.calm;
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
      calm.current = () => undefined;
      window.removeEventListener("focus", schedule.refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [projectId, key, view, place]);

  useEffect(() => {
    const before = seen.current;
    seen.current = { place, finished };
    if (before.place === place && before.finished !== finished && finished !== "") {
      refresh.current();
    }
  }, [place, finished]);

  useEffect(() => {
    calm.current();
  }, [selected]);

  const shownHeader = header?.workspace === here ? header : undefined;
  if (listed?.place !== place) return { list: undefined, error: null, header: shownHeader };
  return { list: listed.list, error: listed.error, header: shownHeader };
}
