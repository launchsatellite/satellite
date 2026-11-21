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
import { failedLines, parseThreads, parseView } from "./pull-request-parse.ts";
import { isPushed } from "./pushed-branch.ts";

export interface PullRequests {
  handlers: Pick<BridgeHandlers, "pullRequest.read" | "pullRequest.log">;
  stopInside(folder: string): Promise<void>;
  stopAll(): Promise<void>;
}

interface Options {
  home: string;
  store: ProjectStore;
  onNeeding: (needing: readonly Needing[]) => void;
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
  jobs: ReadonlySet<string>;
  failures: number;
  holdUntil: number;
}

interface Running {
  detail: boolean;
  answer: Promise<PullRequestAnswer>;
}

type Failure = PullRequestTrouble | "none" | "not-pushed";

const viewMs = 20_000;
const threadsMs = 20_000;
const logMs = 30_000;
const reuseMs = 10_000;
const firstHoldMs = 60_000;
const longestHoldMs = 1_800_000;
const transient = new Set<PullRequestTrouble>(["offline", "hung", "failed", "rate-limited"]);
const gone = "That workspace's folder is gone, so Satellite can't read its pull request.";
const archiving = "Satellite is archiving that workspace, so its pull request can't be read.";
const sentences = { gone, archiving };

function keyOf({ projectId, workspace }: WorkspaceRef): string {
  return `${projectId}/${workspace}`;
}

function unavailable(reason: PullRequestTrouble): PullRequestAnswer {
  return { kind: "unavailable", reason };
}

function troubleOf(failure: Failure): PullRequestTrouble {
  return failure === "none" || failure === "not-pushed" ? "failed" : failure;
}

async function runGh(
  args: readonly string[],
  folder: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ run: ToolRun } | { failure: Failure }> {
  try {
    const run = await runTool("gh", args, { cwd: folder, timeoutMs, signal });
    if (run === undefined) return { failure: ghFailure(undefined, undefined) };
    return run.exitCode === 0 ? { run } : { failure: ghFailure(run, undefined) };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ToolStopped) return { failure: ghFailure(undefined, error.reason) };
    if (error instanceof AbandonedRun) return { failure: "hung" };
    return { failure: "failed" };
  }
}

export function createPullRequests({
  home,
  store,
  onNeeding,
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

  const readDetail = async (
    place: PullRequestPlace,
    folder: string,
    signal: AbortSignal,
  ): Promise<PullRequestDetail> => {
    const result = await pace.run(
      () =>
        pace.paused()
          ? Promise.resolve({ failure: "rate-limited" as const })
          : runGh(threadsArguments(place), folder, threadsMs, signal),
      { signal },
    );
    if ("failure" in result) {
      const reason = troubleOf(result.failure);
      if (reason === "rate-limited") pace.pause();
      return { kind: "unavailable", reason };
    }
    return parseThreads(result.run.stdout, place) ?? { kind: "unavailable", reason: "failed" };
  };

  const readView = async (
    folder: string,
    detail: boolean,
    signal: AbortSignal,
  ): Promise<{ answer: PullRequestAnswer; place: PullRequestPlace | null }> => {
    const viewed = await pace.run(
      async () => {
        if (pace.paused()) return { failure: "rate-limited" as const };
        const branch = await currentBranch(folder, signal);
        if (branch === undefined) return { failure: "failed" as const };
        const pushed = await isPushed(folder, branch, signal);
        if (pushed === undefined) return { failure: "failed" as const };
        if (!pushed) return { failure: "not-pushed" as const };
        const result = await runGh(viewArguments(), folder, viewMs, signal);
        if ("failure" in result) return result;
        return { run: result.run, head: (await headOid(folder, signal)) ?? null };
      },
      { signal },
    );
    if ("failure" in viewed) {
      if (viewed.failure === "rate-limited") pace.pause();
      if (viewed.failure === "none" || viewed.failure === "not-pushed") {
        return { answer: { kind: "absent", reason: viewed.failure }, place: null };
      }
      return { answer: unavailable(viewed.failure), place: null };
    }
    const parsed = parseView(viewed.run.stdout, viewed.head);
    if (parsed === null) return { answer: unavailable("failed"), place: null };
    if (!detail) return { answer: { ...parsed.found, detail: null }, place: parsed.place };
    const read = await readDetail(parsed.place, folder, signal);
    return { answer: { ...parsed.found, detail: read }, place: parsed.place };
  };

  const answerFrom = (held: Remembered, detail: boolean): PullRequestAnswer | undefined => {
    const { answer } = held;
    const enough =
      !detail || answer.kind === "absent" || (answer.kind === "found" && answer.detail !== null);
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
      const result = await readView(folder, detail, controller.signal);
      controller.signal.throwIfAborted();
      remember(key, { folder, workspace, owner }, result.answer, result.place);
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

  return {
    handlers: {
      "pullRequest.read": async ({ workspace, detail }, owner) => {
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
          const reused = answerFrom(held, detail);
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
      const stopping = [...active];
      for (const read of stopping)
        read.controller.abort(new BridgeFailure("refused", "Satellite is closing."));
      await waitForReads(stopping);
    },
  };
}
