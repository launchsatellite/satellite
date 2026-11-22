import { setTimeout as delay } from "node:timers/promises";
import type {
  BridgeResponse,
  PullRequestAnswer,
  PullRequestDetail,
  PullRequestFound,
  PullRequestTrouble,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers, type BridgeOwner } from "../bridge/registry.ts";
import { currentBranch, headOid } from "../changes/change-base.ts";
import { waitForReads, type ActiveRead } from "../changes/changes-handlers.ts";
import type { Needing } from "../inbox/notices.ts";
import { isInsidePath } from "../platform/paths.ts";
import { AbandonedRun, runTool, ToolStopped, type ToolRun } from "../platform/tools.ts";
import type { ProjectStore } from "../projects/project-list.ts";
import { sessionFolder } from "../sessions/session-folder.ts";
import {
  logArguments,
  threadsArguments,
  viewArguments,
  type PullRequestPlace,
} from "./gh-arguments.ts";
import { ghFailure } from "./gh-failure.ts";
import { createPace } from "./gh-pace.ts";
import {
  failedLines,
  parseConversation,
  parseView,
  type Conversation,
} from "./pull-request-parse.ts";
import { branchFacts, isPushed, type BranchFacts } from "./pushed-branch.ts";

export interface PullRequests {
  handlers: Pick<BridgeHandlers, "pullRequest.read" | "pullRequest.log">;
  stopInside(folder: string): Promise<void>;
  stopAll(): Promise<void>;
  sweepStale(): Promise<void>;
}

interface Options {
  home: string;
  store: ProjectStore;
  onNeeding: (needing: readonly Needing[]) => void;
  sweepEveryMs?: number;
  now?: () => number;
  after?: (ms: number) => Promise<void>;
}

interface Remembered {
  answer: PullRequestAnswer;
  at: number;
  folder: string;
  workspace: WorkspaceRef;
  owner: BridgeOwner;
  kept: PullRequestFound | null;
  place: PullRequestPlace | null;
  verified: string | null;
  jobs: ReadonlySet<string>;
  failures: number;
  holdUntil: number;
}

interface Running {
  detail: boolean;
  answer: Promise<PullRequestAnswer>;
}

type Failure = PullRequestTrouble | "none" | "not-pushed" | "target";

const viewMs = 20_000;
const threadsMs = 20_000;
const logMs = 30_000;
export const reuseMs = 10_000;
export const staleMs = 360_000;
const settledTroubles = new Set<PullRequestTrouble>([
  "signed-out",
  "gh-missing",
  "gh-old",
  "other-host",
]);
const firstHoldMs = 60_000;
const longestHoldMs = 1_800_000;
const transient = new Set<PullRequestTrouble>(["offline", "hung", "failed", "rate-limited"]);
const gone = "That workspace's folder is gone, so Satellite can't read its pull request.";
const archiving = "Satellite is archiving that workspace, so its pull request can't be read.";
const sentences = { gone, archiving };

function isSettled(answer: PullRequestAnswer): boolean {
  return answer.kind === "unavailable" && settledTroubles.has(answer.reason);
}

function addressKey({ host, owner, repo, number }: PullRequestPlace): string {
  return `${host}/${owner}/${repo}#${String(number)}`;
}

function keyOf({ projectId, workspace }: WorkspaceRef): string {
  return `${projectId}/${workspace}`;
}

function unavailable(reason: PullRequestTrouble): PullRequestAnswer {
  return { kind: "unavailable", reason };
}

function troubleOf(failure: Failure): PullRequestTrouble {
  return failure === "none" || failure === "not-pushed" || failure === "target"
    ? "failed"
    : failure;
}

async function runGh(
  args: readonly string[],
  folder: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ run: ToolRun } | { failure: Failure; oversize?: boolean }> {
  try {
    const run = await runTool("gh", args, { cwd: folder, timeoutMs, signal });
    if (run === undefined) return { failure: ghFailure(undefined, undefined) };
    return run.exitCode === 0 ? { run } : { failure: ghFailure(run, undefined) };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ToolStopped) {
      return { failure: ghFailure(undefined, error.reason), oversize: error.reason === "output" };
    }
    if (error instanceof AbandonedRun) return { failure: "hung" };
    return { failure: "failed" };
  }
}

function sameRepository(
  left: { owner: string; repo: string },
  right: { owner: string; repo: string },
): boolean {
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.repo.toLowerCase() === right.repo.toLowerCase()
  );
}

function belongsTo(
  found: { head: string | null; base: string | null; crossRepository: boolean },
  place: PullRequestPlace,
  branch: string | null,
  facts: BranchFacts,
): boolean {
  if (facts.isDefault || found.head === null) return false;
  if (found.base !== null && found.base === branch) return false;
  if (!found.crossRepository) return found.head === branch || found.head === facts.upstream;
  return (
    found.head === facts.upstream &&
    facts.upstreamRepository !== null &&
    !sameRepository(facts.upstreamRepository, place)
  );
}

export function createPullRequests({
  home,
  store,
  onNeeding,
  sweepEveryMs,
  now = () => performance.now(),
  after = (ms) => delay(ms),
}: Options): PullRequests {
  const pace = createPace({ now, after });
  const memory = new Map<string, Remembered>();
  const running = new Map<string, Running>();
  const active = new Set<ActiveRead>();
  const logging = new Map<string, Promise<BridgeResponse<"pullRequest.log">>>();
  const lastLogs = new Map<string, { at: number; answer: BridgeResponse<"pullRequest.log"> }>();
  let told = "";

  const tellNeeding = () => {
    const needing = [...memory.values()].flatMap(({ kept, workspace, owner }) =>
      kept !== null && kept.needs.length > 0
        ? [{ workspace, owner, reason: "pull-request" as const }]
        : [],
    );
    const signature = needing
      .map(({ workspace, owner }) => `${keyOf(workspace)}@${String(owner.id)}`)
      .join("\n");
    if (signature === told) return;
    told = signature;
    onNeeding(needing);
  };

  const remember = (
    key: string,
    base: Pick<Remembered, "folder" | "workspace" | "owner">,
    answer: PullRequestAnswer,
    place: PullRequestPlace | null,
    verified: string | null,
  ) => {
    const before = memory.get(key);
    const failed = answer.kind === "unavailable";
    const keeps = answer.kind === "unavailable" && transient.has(answer.reason);
    const kept = answer.kind === "found" ? answer : keeps ? (before?.kept ?? null) : null;
    const failures = failed ? (before?.failures ?? 0) + 1 : 0;
    const hold = Math.min(firstHoldMs * 2 ** (failures - 1), longestHoldMs);
    memory.set(key, {
      ...base,
      answer,
      at: now(),
      kept,
      place: answer.kind === "found" ? place : keeps ? (before?.place ?? null) : null,
      verified: answer.kind === "found" ? verified : keeps ? (before?.verified ?? null) : null,
      jobs:
        answer.kind === "found"
          ? new Set(answer.checks.flatMap((check) => (check.job === null ? [] : [check.job])))
          : keeps
            ? (before?.jobs ?? new Set())
            : new Set(),
      failures,
      holdUntil: failed ? now() + hold : 0,
    });
    tellNeeding();
  };

  const rememberLog = (
    workspaceKey: string,
    asked: string,
    answer: BridgeResponse<"pullRequest.log">,
  ) => {
    for (const key of lastLogs.keys()) {
      if (key.startsWith(`${workspaceKey}/`)) lastLogs.delete(key);
    }
    lastLogs.set(asked, { at: now(), answer });
  };

  const askConversation = async (
    place: PullRequestPlace,
    head: string,
    detail: boolean,
    folder: string,
    signal: AbortSignal,
  ): Promise<Conversation | { failure: PullRequestTrouble }> => {
    const result = await pace.run(
      () =>
        pace.paused()
          ? Promise.resolve({ failure: "rate-limited" as const })
          : runGh(threadsArguments(place, head, detail), folder, threadsMs, signal),
      { signal },
    );
    if ("failure" in result) {
      const reason = troubleOf(result.failure);
      if (reason === "rate-limited") pace.pause();
      return { failure: reason };
    }
    return parseConversation(result.run.stdout, place, detail) ?? { failure: "failed" };
  };

  const readNumber = async (
    number: number,
    local: string | null,
    folder: string,
    signal: AbortSignal,
  ): Promise<ReturnType<typeof parseView> | { failure: PullRequestTrouble }> => {
    const result = await pace.run(
      () =>
        pace.paused()
          ? Promise.resolve({ failure: "rate-limited" as const })
          : runGh(viewArguments(number), folder, viewMs, signal),
      { signal },
    );
    if ("failure" in result) {
      const reason = troubleOf(result.failure);
      if (reason === "rate-limited") pace.pause();
      return { failure: reason };
    }
    return parseView(result.run.stdout, local);
  };

  const readView = async (
    folder: string,
    detail: boolean,
    signal: AbortSignal,
    known: string | null,
  ): Promise<{
    answer: PullRequestAnswer;
    place: PullRequestPlace | null;
    verified: string | null;
  }> => {
    const nothing = (answer: PullRequestAnswer) => ({ answer, place: null, verified: null });
    const viewed = await pace.run(
      async () => {
        if (pace.paused()) return { failure: "rate-limited" as const };
        const branch = await currentBranch(folder, signal);
        if (branch === undefined) return { failure: "failed" as const };
        const pushed = await isPushed(folder, branch, signal);
        if (pushed === undefined) return { failure: "failed" as const };
        if (!pushed) return { failure: "not-pushed" as const };
        const facts = await branchFacts(folder, branch, signal);
        if (facts === undefined) return { failure: "failed" as const };
        if (facts.isDefault) return { failure: "target" as const };
        const result = await runGh(viewArguments(), folder, viewMs, signal);
        if ("failure" in result) return result;
        return { run: result.run, head: (await headOid(folder, signal)) ?? null, branch, facts };
      },
      { signal },
    );
    if ("failure" in viewed) {
      if (viewed.failure === "rate-limited") pace.pause();
      if (
        viewed.failure === "none" ||
        viewed.failure === "not-pushed" ||
        viewed.failure === "target"
      ) {
        return nothing({ kind: "absent", reason: viewed.failure });
      }
      return nothing(unavailable(viewed.failure));
    }
    let parsed = parseView(viewed.run.stdout, viewed.head);
    if (parsed === null) return nothing(unavailable("failed"));
    if (parsed.found.base !== null && parsed.found.base === viewed.branch) {
      return nothing({ kind: "absent", reason: "target" });
    }
    if (
      !belongsTo(parsed.found, parsed.place, viewed.branch, viewed.facts) ||
      parsed.found.head === null
    ) {
      return nothing({ kind: "absent", reason: "none" });
    }
    const head = parsed.found.head;
    let conversation: Conversation | null = null;
    if (detail || known !== addressKey(parsed.place)) {
      const asked = await askConversation(parsed.place, head, detail, folder, signal);
      if ("failure" in asked) return nothing(unavailable(asked.failure));
      conversation = asked;
      const number = parsed.found.number;
      if (!asked.candidates.some((candidate) => candidate.number === number && candidate.trusted)) {
        const trusted = asked.candidates.filter((candidate) => candidate.trusted);
        const better =
          trusted.find((candidate) => candidate.here && candidate.open) ??
          trusted.find((candidate) => candidate.here) ??
          trusted.find((candidate) => candidate.open) ??
          trusted[0];
        if (better === undefined) return nothing({ kind: "absent", reason: "none" });
        const again = await readNumber(better.number, viewed.head, folder, signal);
        if (again === null) return nothing(unavailable("failed"));
        if ("failure" in again) return nothing(unavailable(again.failure));
        if (
          again.place.host !== parsed.place.host ||
          !sameRepository(again.place, parsed.place) ||
          !belongsTo(again.found, again.place, viewed.branch, viewed.facts)
        ) {
          return nothing({ kind: "absent", reason: "none" });
        }
        parsed = again;
        conversation = null;
        if (detail) {
          const own = await askConversation(again.place, head, true, folder, signal);
          if ("failure" in own) return nothing(unavailable(own.failure));
          conversation = own;
        }
      }
    }
    const verified = addressKey(parsed.place);
    if (!detail) {
      return { answer: { ...parsed.found, detail: null }, place: parsed.place, verified };
    }
    const read: PullRequestDetail = conversation?.detail ?? {
      kind: "unavailable",
      reason: "failed",
    };
    return { answer: { ...parsed.found, detail: read }, place: parsed.place, verified };
  };

  const answerFrom = (
    held: Remembered,
    detail: boolean,
    fresh: boolean,
  ): PullRequestAnswer | undefined => {
    const { answer } = held;
    if (fresh) return undefined;
    const enough =
      !detail ||
      isSettled(answer) ||
      answer.kind === "absent" ||
      (answer.kind === "found" && answer.detail !== null);
    if (now() - held.at < reuseMs && enough) return answer;
    if (!detail && answer.kind === "unavailable" && now() < held.holdUntil) return answer;
    return undefined;
  };

  const start = (
    key: string,
    workspace: WorkspaceRef,
    folder: string,
    detail: boolean,
    owner: BridgeOwner,
  ): Running => {
    const controller = new AbortController();
    const read: ActiveRead = { controller, folder, done: Promise.resolve() };
    active.add(read);
    const answer = (async () => {
      const result = await readView(
        folder,
        detail,
        controller.signal,
        memory.get(key)?.verified ?? null,
      );
      controller.signal.throwIfAborted();
      remember(key, { folder, workspace, owner }, result.answer, result.place, result.verified);
      return result.answer;
    })().finally(() => {
      active.delete(read);
      if (running.get(key)?.answer === answer) running.delete(key);
    });
    read.done = answer.then(
      () => undefined,
      () => undefined,
    );
    const entry = { detail, answer };
    running.set(key, entry);
    return entry;
  };

  const logOf = async (
    place: PullRequestPlace,
    job: string,
    folder: string,
    owner: string,
  ): Promise<BridgeResponse<"pullRequest.log">> => {
    const controller = new AbortController();
    const read: ActiveRead = { controller, folder, done: Promise.resolve() };
    active.add(read);
    try {
      const result = await pace.run(
        () =>
          pace.paused()
            ? Promise.resolve({ failure: "rate-limited" as const })
            : runGh(logArguments(place, job), folder, logMs, controller.signal),
        { signal: controller.signal, lane: "log", owner },
      );
      if ("failure" in result) {
        if (result.oversize === true) return { kind: "too-large" };
        const reason = troubleOf(result.failure);
        if (reason === "rate-limited") pace.pause();
        return { kind: "unavailable", reason };
      }
      const { lines, more } = failedLines(result.run.stdout);
      return lines.length === 0 ? { kind: "empty" } : { kind: "lines", lines, more };
    } finally {
      active.delete(read);
    }
  };

  let closing = false;

  const sweepStale = async () => {
    const stale = [...memory].filter(
      ([key, held]) =>
        !closing &&
        !running.has(key) &&
        held.kept?.state === "open" &&
        now() - held.at >= staleMs &&
        now() >= held.holdUntil,
    );
    for (const [key, held] of stale) {
      if (closing || pace.paused()) return;
      if (running.has(key) || memory.get(key) !== held) continue;
      await start(key, held.workspace, held.folder, false, held.owner).answer.catch(
        () => undefined,
      );
    }
  };
  const sweeper =
    sweepEveryMs === undefined
      ? undefined
      : setInterval(() => {
          void sweepStale();
        }, sweepEveryMs);
  sweeper?.unref();

  return {
    sweepStale,
    handlers: {
      "pullRequest.read": async ({ workspace, detail, fresh = false }, owner) => {
        const folder = await sessionFolder(home, store, workspace, sentences);
        const key = keyOf(workspace);
        let joined = running.get(key);
        if (joined !== undefined && !joined.detail && detail) {
          await joined.answer.catch(() => undefined);
          joined = running.get(key);
        }
        if (joined !== undefined && (joined.detail || !detail)) return joined.answer;
        const held = memory.get(key);
        if (held !== undefined) {
          held.owner = owner;
          const reused = answerFrom(held, detail, fresh);
          if (reused !== undefined) return reused;
        }
        if (pace.paused()) return unavailable("rate-limited");
        return start(key, workspace, folder, detail, owner).answer;
      },
      "pullRequest.log": async ({ workspace, job }) => {
        const folder = await sessionFolder(home, store, workspace, sentences);
        const held = memory.get(keyOf(workspace));
        if (held === undefined || held.place === null || !held.jobs.has(job)) {
          throw new BridgeFailure("not-found", "That check is not on this pull request.");
        }
        if (pace.paused()) return { kind: "unavailable", reason: "rate-limited" };
        const asked = `${keyOf(workspace)}/${job}`;
        const recent = lastLogs.get(asked);
        if (recent !== undefined && now() - recent.at < reuseMs) return recent.answer;
        const joined = logging.get(asked);
        if (joined !== undefined) return joined;
        const answer = logOf(held.place, job, folder, keyOf(workspace)).then((got) => {
          if (got.kind !== "unavailable") rememberLog(keyOf(workspace), asked, got);
          return got;
        });
        logging.set(asked, answer);
        void answer
          .finally(() => {
            logging.delete(asked);
          })
          .catch(() => undefined);
        return answer;
      },
    },
    async stopInside(folder) {
      const stopping = [...active].filter(
        (read) => read.folder !== undefined && isInsidePath(folder, read.folder),
      );
      for (const read of stopping) read.controller.abort(new BridgeFailure("not-found", gone));
      for (const [key, held] of memory) {
        if (!isInsidePath(folder, held.folder)) continue;
        memory.delete(key);
        for (const asked of lastLogs.keys()) {
          if (asked.startsWith(`${key}/`)) lastLogs.delete(asked);
        }
      }
      tellNeeding();
      await waitForReads(stopping);
    },
    async stopAll() {
      closing = true;
      clearInterval(sweeper);
      const stopping = [...active];
      for (const read of stopping)
        read.controller.abort(new BridgeFailure("refused", "Satellite is closing."));
      await waitForReads(stopping);
    },
  };
}
