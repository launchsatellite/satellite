import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PullRequestAnswer,
  PullRequestFound,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { nextNeed } from "../inbox/need-order.ts";
import { createSchedule, type Pace } from "../ui/refresh-schedule.ts";

export interface PullRequestEntry {
  answer: PullRequestAnswer | null;
  last: PullRequestFound | null;
  needsSince: number | null;
}
export interface PullRequests {
  of: (ref: WorkspaceRef) => PullRequestEntry | undefined;
  refresh: (ref: WorkspaceRef) => void;
}
interface PullRequestsInput {
  listed: readonly WorkspaceRef[];
  shown: WorkspaceRef | null;
  detail: boolean;
  finished: string;
  finishedElsewhere: ReadonlyMap<string, string>;
}

const shownPace: Pace = { firstMs: 30_000, maxMs: 300_000, factor: 4 };
const sweepMs = 300_000;
const keepsLast = new Set(["offline", "hung", "failed", "rate-limited"]);
const failedAnswer: PullRequestAnswer = { kind: "unavailable", reason: "failed" };

export function foundOf(entry: PullRequestEntry | undefined): PullRequestFound | null {
  if (entry === undefined) return null;
  return entry.answer?.kind === "found" ? entry.answer : entry.last;
}

function placeOf(ref: WorkspaceRef): string {
  return `${ref.projectId}/${ref.workspace}`;
}

function isVisible(): boolean {
  return document.visibilityState === "visible";
}

function keeps(answer: PullRequestAnswer): boolean {
  return answer.kind === "unavailable" && keepsLast.has(answer.reason);
}

function settled(
  previous: PullRequestEntry | undefined,
  answer: PullRequestAnswer,
): PullRequestEntry {
  const last = answer.kind === "found" ? answer : keeps(answer) ? (previous?.last ?? null) : null;
  const needing = last !== null && last.needs.length > 0;
  const needsSince = needing ? (previous?.needsSince ?? nextNeed()) : null;
  const next = { answer, last, needsSince };
  return previous !== undefined && JSON.stringify(previous) === JSON.stringify(next)
    ? previous
    : next;
}

async function read(ref: WorkspaceRef, detail: boolean): Promise<PullRequestAnswer> {
  const result = await invoke("pullRequest.read", { workspace: ref, detail });
  return result.ok ? result.value : failedAnswer;
}

export function usePullRequests({
  listed,
  shown,
  detail,
  finished,
  finishedElsewhere,
}: PullRequestsInput): PullRequests {
  const [entries, setEntries] = useState<ReadonlyMap<string, PullRequestEntry>>(new Map());
  const refreshShown = useRef<() => void>(() => undefined);
  const askOther = useRef<(place: string) => void>(() => undefined);
  const detailNow = useRef(detail);
  const listedNow = useRef(listed);
  const seenDone = useRef(new Map<string, string>());
  const shownPlace = shown === null ? null : placeOf(shown);
  const shownNow = useRef(shownPlace);
  const listedKey = listed.map(placeOf).sort().join("\n");

  const store = useCallback((ref: WorkspaceRef, answer: PullRequestAnswer) => {
    setEntries((current) => {
      const place = placeOf(ref);
      const previous = current.get(place);
      const next = settled(previous, answer);
      if (next === previous) return current;
      return new Map(current).set(place, next);
    });
  }, []);

  useEffect(() => {
    detailNow.current = detail;
    listedNow.current = listed;
    shownNow.current = shownPlace;
  });

  const [prunedFor, setPrunedFor] = useState(listedKey);
  if (prunedFor !== listedKey) {
    setPrunedFor(listedKey);
    const live = new Set(listedKey.split("\n"));
    const kept = [...entries].filter(([place]) => live.has(place));
    if (kept.length !== entries.size) setEntries(new Map(kept));
  }

  useEffect(() => {
    if (shown === null) return;
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
          const answer = await read(shown, detailNow.current);
          if (!stopped) store(shown, answer);
          return { files: answer.kind !== "unavailable", key: JSON.stringify(answer) };
        },
      },
      shownPace,
    );
    const onVisibility = () => {
      if (isVisible()) schedule.refresh();
      else schedule.hide();
    };
    refreshShown.current = schedule.refresh;
    window.addEventListener("focus", schedule.refresh);
    document.addEventListener("visibilitychange", onVisibility);
    schedule.start();
    return () => {
      stopped = true;
      schedule.stop();
      refreshShown.current = () => undefined;
      window.removeEventListener("focus", schedule.refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [shown, store]);

  useEffect(() => {
    const everyone = listedNow.current;
    if (everyone.length === 0) {
      askOther.current = () => undefined;
      return;
    }
    const stop = new AbortController();
    const live = () => !stop.signal.aborted;
    const waiting: WorkspaceRef[] = [];
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      for (let ref = waiting.shift(); ref !== undefined; ref = waiting.shift()) {
        if (!live() || !isVisible()) break;
        const answer = await read(ref, false);
        if (live()) store(ref, answer);
      }
      draining = false;
    };
    const ask = (ref: WorkspaceRef) => {
      if (!live() || !isVisible() || placeOf(ref) === shownNow.current) return;
      if (!waiting.some((one) => placeOf(one) === placeOf(ref))) waiting.push(ref);
      void drain();
    };
    const askAll = () => {
      everyone.forEach(ask);
    };
    askOther.current = (place) => {
      const ref = everyone.find((one) => placeOf(one) === place);
      if (ref !== undefined) ask(ref);
    };
    askAll();
    const timer = setInterval(askAll, sweepMs);
    const onVisibility = () => {
      if (isVisible()) askAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop.abort();
      clearInterval(timer);
      askOther.current = () => undefined;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [listedKey, store]);

  const seenShown = useRef(shownPlace);
  useEffect(() => {
    const before = seenShown.current;
    seenShown.current = shownPlace;
    if (before !== null && before !== shownPlace) askOther.current(before);
  }, [shownPlace]);

  const seenFinished = useRef({ place: shownPlace, finished });
  useEffect(() => {
    const before = seenFinished.current;
    seenFinished.current = { place: shownPlace, finished };
    if (before.place === shownPlace && before.finished !== finished && finished !== "") {
      refreshShown.current();
    }
  }, [shownPlace, finished]);

  const seenDetail = useRef(detail);
  useEffect(() => {
    const before = seenDetail.current;
    seenDetail.current = detail;
    if (detail && !before) refreshShown.current();
  }, [detail]);

  useEffect(() => {
    const before = seenDone.current;
    for (const [place, done] of finishedElsewhere) {
      const keys = new Set((before.get(place) ?? "").split(" "));
      if (done.split(" ").some((key) => key !== "" && !keys.has(key))) askOther.current(place);
    }
    seenDone.current = new Map(finishedElsewhere);
  }, [finishedElsewhere]);

  const of = useCallback((ref: WorkspaceRef) => entries.get(placeOf(ref)), [entries]);
  const refresh = useCallback(
    (ref: WorkspaceRef) => {
      if (placeOf(ref) === shownPlace) refreshShown.current();
      else askOther.current(placeOf(ref));
    },
    [shownPlace],
  );
  return { of, refresh };
}
