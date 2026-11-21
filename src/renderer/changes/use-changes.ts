import { useEffect, useRef, useState } from "react";
import type {
  BridgeResult,
  ChangesList,
  ChangesView,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { unavailableSentence } from "./change-words.ts";

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

export function pollDelay(elapsedMs: number, failures: number): number {
  const backoff = changesPollMs * 2 ** failures;
  return Math.min(changesPollMaxMs, Math.max(backoff, changesPollFactor * elapsedMs));
}

export function changesPlace(workspace: WorkspaceRef, view: ChangesView): string {
  return `${workspace.projectId}/${workspace.workspace}/${view}`;
}

export function useChanges(
  workspace: WorkspaceRef | null,
  view: ChangesView,
  finished: string,
): { list: ChangesList | undefined; error: string | null } {
  const [listed, setListed] = useState<ListedPlace | null>(null);
  const refresh = useRef<() => void>(() => undefined);
  const seen = useRef<{ place: string | null; finished: string }>({ place: null, finished });
  const projectId = workspace?.projectId;
  const key = workspace?.workspace;
  const place = workspace === null ? null : changesPlace(workspace, view);

  useEffect(() => {
    if (projectId === undefined || key === undefined || place === null) return;
    let stopped = false;
    let running = false;
    let again = false;
    let failures = 0;
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
          failures = result.ok && result.value.changes.kind === "files" ? 0 : failures + 1;
          setListed((current) => settled(current, answered(current, place, result)));
          if (again) {
            again = false;
            ask();
          } else if (isVisible()) {
            timer = setTimeout(ask, pollDelay(performance.now() - began, failures));
          }
        },
      );
    };
    const askAfresh = () => {
      failures = 0;
      ask();
    };
    const onVisibility = () => {
      if (isVisible()) askAfresh();
      else clearTimeout(timer);
    };
    refresh.current = askAfresh;
    window.addEventListener("focus", askAfresh);
    document.addEventListener("visibilitychange", onVisibility);
    ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
      refresh.current = () => undefined;
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

  if (listed?.place !== place) return { list: undefined, error: null };
  return { list: listed.list, error: listed.error };
}
