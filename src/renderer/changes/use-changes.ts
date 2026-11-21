import { useEffect, useRef, useState } from "react";
import type {
  BridgeResult,
  ChangesList,
  ChangesView,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
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

export const changesPollMs = 2000;
export const changesPollMaxMs = 30_000;
export const changesPollFactor = 4;

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

export function pollDelay(elapsedMs: number, failures: number): number {
  const backoff = changesPollMs * 2 ** failures;
  return Math.min(changesPollMaxMs, Math.max(backoff, changesPollFactor * elapsedMs));
}

export function nextSteps(steps: number, answeredFiles: boolean, changed: boolean): number {
  return answeredFiles && changed ? 0 : steps + 1;
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
    let running = false;
    let again = false;
    let steps = 0;
    let last = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      clearTimeout(timer);
      timer = undefined;
      if (stopped || !isVisible()) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      const began = performance.now();
      void invoke("changes.list", { workspace: { projectId, workspace: key }, view }).then(
        (result) => {
          running = false;
          if (stopped) return;
          const answer = JSON.stringify(result);
          steps = nextSteps(
            steps,
            result.ok && result.value.changes.kind === "files",
            answer !== last,
          );
          last = answer;
          setListed((current) => settled(current, answered(current, place, result)));
          if (result.ok) {
            const { base, ahead, behind } = result.value;
            const next = { workspace: `${projectId}/${key}`, base, ahead, behind };
            setHeader((current) => (sameHeader(current, next) ? current : next));
          }
          if (again) {
            again = false;
            ask();
          } else if (isVisible()) {
            timer = setTimeout(ask, pollDelay(performance.now() - began, steps));
          }
        },
      );
    };
    const askAfresh = () => {
      steps = 0;
      ask();
    };
    const settle = () => {
      steps = 0;
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = setTimeout(ask, changesPollMs);
    };
    const onVisibility = () => {
      if (isVisible()) askAfresh();
      else clearTimeout(timer);
    };
    refresh.current = askAfresh;
    calm.current = settle;
    window.addEventListener("focus", askAfresh);
    document.addEventListener("visibilitychange", onVisibility);
    ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
      refresh.current = () => undefined;
      calm.current = () => undefined;
      window.removeEventListener("focus", askAfresh);
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
