import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PullRequestAnswer,
  PullRequestFound,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { invoke, subscribe } from "../bridge/bridge-client.ts";
import type { PullRequestNeeding } from "../inbox/inbox.ts";
import { nextNeed } from "../inbox/need-order.ts";
import { createSchedule, type Pace } from "../ui/refresh-schedule.ts";

export interface PullRequestEntry {
  answer: PullRequestAnswer | null;
  last: PullRequestFound | null;
  branch: string | null;
}
export interface PullRequests {
  of: (ref: WorkspaceRef) => PullRequestEntry | undefined;
  needing: readonly PullRequestNeeding[];
}
interface PullRequestsInput {
  listed: readonly WorkspaceRef[];
  branches: ReadonlyMap<string, string | null>;
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
  branch: string | null,
): PullRequestEntry {
  const found = answer.kind === "found";
  const last = found ? answer : keeps(answer) ? (previous?.last ?? null) : null;
  const next = { answer, last, branch: found ? branch : (previous?.branch ?? null) };
  return previous !== undefined && JSON.stringify(previous) === JSON.stringify(next)
    ? previous
    : next;
}

async function read(
  ref: WorkspaceRef,
  detail: boolean,
  fresh: boolean,
): Promise<PullRequestAnswer> {
  const result = await invoke("pullRequest.read", { workspace: ref, detail, fresh });
  return result.ok ? result.value : failedAnswer;
}

export function usePullRequests({
  listed,
  branches,
  shown,
  detail,
  finished,
  finishedElsewhere,
}: PullRequestsInput): PullRequests {
  const [entries, setEntries] = useState<ReadonlyMap<string, PullRequestEntry>>(new Map());
  const [told, setTold] = useState<ReadonlyMap<string, PullRequestNeeding>>(new Map());
  const branchesNow = useRef(branches);
  const refreshShown = useRef<() => void>(() => undefined);
  const askOther = useRef<(place: string, fresh?: boolean) => void>(() => undefined);
  const freshNext = useRef(false);
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
      const next = settled(previous, answer, branchesNow.current.get(place) ?? null);
      if (next === previous) return current;
      return new Map(current).set(place, next);
    });
  }, []);

  useEffect(
    () =>
      subscribe("pullRequests.needing", ({ needing }) => {
        setTold((current) => {
          const next = new Map<string, PullRequestNeeding>();
          for (const { workspace, needs } of needing) {
            const place = placeOf(workspace);
            next.set(place, { workspace, needs, since: current.get(place)?.since ?? nextNeed() });
          }
          return next;
        });
      }),
    [],
  );

  useEffect(() => {
    branchesNow.current = branches;
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
          const fresh = freshNext.current;
          freshNext.current = false;
          const answer = await read(shown, detailNow.current, fresh);
          if (!stopped) store(shown, answer);
          return { files: answer.kind !== "unavailable", key: JSON.stringify(answer) };
        },
      },
      shownPace,
    );
    const refreshNow = () => {
      freshNext.current = true;
      schedule.refresh();
    };
    const onVisibility = () => {
      if (isVisible()) refreshNow();
      else schedule.hide();
    };
    refreshShown.current = refreshNow;
    window.addEventListener("focus", refreshNow);
    document.addEventListener("visibilitychange", onVisibility);
    schedule.start();
    return () => {
      stopped = true;
      schedule.stop();
      refreshShown.current = () => undefined;
      window.removeEventListener("focus", refreshNow);
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
    const waiting: { ref: WorkspaceRef; fresh: boolean }[] = [];
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
        if (!live() || !isVisible()) break;
        const { ref, fresh } = next;
        const answer = await read(ref, false, fresh);
        if (live()) store(ref, answer);
      }
      draining = false;
    };
    const ask = (ref: WorkspaceRef, fresh = false) => {
      if (!live() || !isVisible() || placeOf(ref) === shownNow.current) return;
      const queued = waiting.find((one) => placeOf(one.ref) === placeOf(ref));
      if (queued === undefined) waiting.push({ ref, fresh });
      else queued.fresh ||= fresh;
      void drain();
    };
    const askAll = () => {
      everyone.forEach((ref) => {
        ask(ref);
      });
    };
    askOther.current = (place, fresh = false) => {
      const ref = everyone.find((one) => placeOf(one) === place);
      if (ref !== undefined) ask(ref, fresh);
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
    if (before !== null && before !== shownPlace) askOther.current(before, true);
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
      if (done.split(" ").some((key) => key !== "" && !keys.has(key)))
        askOther.current(place, true);
    }
    seenDone.current = new Map(finishedElsewhere);
  }, [finishedElsewhere]);

  const of = useCallback(
    (ref: WorkspaceRef) => {
      const place = placeOf(ref);
      const entry = entries.get(place);
      if (entry?.answer?.kind === "found" || entry?.last == null) return entry;
      return branches.get(place) === entry.branch ? entry : { ...entry, last: null };
    },
    [entries, branches],
  );
  const needing = useMemo(() => {
    const live = new Set(listed.map(placeOf));
    return [...told].flatMap(([place, need]) => (live.has(place) ? [need] : []));
  }, [told, listed]);
  return { of, needing };
}
