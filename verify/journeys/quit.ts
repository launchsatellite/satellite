import assert from "node:assert/strict";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { z } from "zod";
import {
  bridgeAnswer,
  claudePids,
  goneTimeoutMs,
  hooksAnswered,
  processGone,
  promptTimeoutMs,
  stateIs,
  startClaude,
  waitUntil,
} from "./conditions.ts";

const processesAnswer = z.object({
  ok: z.literal(true),
  value: z.object({ rows: z.array(z.unknown()) }),
});

interface Started {
  claudePid: number;
  childPid: number;
}

async function startWithChild(session: AppSession): Promise<Started> {
  await session.page.getByTestId("workspace-repo-main").click();
  await session.page.getByTestId("start-claude").click();
  let started: Started | undefined;
  await waitUntil(
    async () => {
      const events = await session.standInEvents();
      const childPid = events.flatMap((event) => (event.type === "child" ? [event.pid] : []))[0];
      const claudePid = events.flatMap((event) =>
        event.type === "start" && event.tool === "claude" ? [event.pid] : [],
      )[0];
      if (childPid !== undefined && claudePid !== undefined) started = { claudePid, childPid };
      return started !== undefined;
    },
    promptTimeoutMs,
    "the stand-in started no child that ignores hangup",
  );
  if (started === undefined) throw new Error("the stand-in logged no child");
  return started;
}

async function run(session: AppSession): Promise<void> {
  const { claudePid, childPid } = await startWithChild(session);
  assert.ok(!processGone(childPid), "the child that ignores hangup was gone before quit");
  const { exitedOnItsOwn } = await session.close();
  assert.ok(exitedOnItsOwn, "the app was still running 10 seconds after its window closed");
  await waitUntil(
    () => processGone(claudePid) && processGone(childPid),
    goneTimeoutMs,
    () =>
      `after quit the stand-in ${processGone(claudePid) ? "was gone" : "still ran"} and its child that ignores hangup ${processGone(childPid) ? "was gone" : "still ran"}`,
  );
}

async function questionsAtQuit(session: AppSession): Promise<string[]> {
  await session.quit();
  const asked = (await session.notices()).flatMap((line) =>
    line.kind === "question" ? [line.message] : [],
  );
  await session.relaunch();
  return asked;
}

async function asksOnlyWhileUnfinished(session: AppSession): Promise<void> {
  await session.page.getByTestId("workspace-repo-alpha").click();
  const idlePid = await startClaude(session, 1);
  await stateIs(session, "session-tab-1", "idle", "in alpha before any prompt");
  const idleAsked = await questionsAtQuit(session);
  assert.deepEqual(idleAsked, [], `quitting with an idle session asked ${idleAsked.join(", ")}`);
  await waitUntil(() => processGone(idlePid), goneTimeoutMs, "the idle stand-in outlived quit");
  await session.page.getByTestId("workspace-repo-beta").click();
  await startClaude(session, 2);
  await session.page.getByTestId("workspace-repo-alpha").click();
  await startClaude(session, 3);
  await session.page.keyboard.press("Enter");
  await waitUntil(
    async () => (await hooksAnswered(session, "UserPromptSubmit")) === 1,
    promptTimeoutMs,
    "alpha's prompt reached no hook",
  );
  await stateIs(session, "session-tab-1", "working", "in alpha after its prompt");
  const pids = await claudePids(session);
  const asked = await questionsAtQuit(session);
  assert.deepEqual(
    asked,
    ["Quitting stops 1 Claude Code session mid-task."],
    `quitting with one working and one idle session asked ${JSON.stringify(asked)}`,
  );
  await waitUntil(
    () => pids.every(processGone),
    goneTimeoutMs,
    "a stand-in outlived the quit that asked",
  );
}

async function asksForRunningProcesses(session: AppSession): Promise<void> {
  await session.page.getByTestId("workspace-repo-main").click();
  await startClaude(session, 1);
  await session.page.keyboard.press("Enter");
  await stateIs(session, "session-tab-1", "done", "after the turn that started a dev server");
  let rows = 0;
  await waitUntil(
    async () => {
      const answer = processesAnswer.safeParse(
        await bridgeAnswer(session.page, "processes.list", {}),
      );
      rows = answer.success ? answer.data.value.rows.length : 0;
      return rows > 0;
    },
    promptTimeoutMs,
    "Running processes never listed the dev server",
  );
  const asked = await questionsAtQuit(session);
  assert.deepEqual(
    asked,
    [`Quitting stops ${String(rows)} process${rows === 1 ? "" : "es"} Claude Code started.`],
    `quitting with a done session whose dev server runs asked ${JSON.stringify(asked)}`,
  );
}

const systemQuit =
  process.platform === "win32" ? "SIGTERM ends a process on Windows without a quit" : undefined;

export const quitJourney: Journey = {
  name: "quit",
  scenario: "flood",
  run,
  then: [
    { name: "quit", scenario: "needs-permission", run: asksOnlyWhileUnfinished, skip: systemQuit },
    { name: "quit", scenario: "dev-server", run: asksForRunningProcesses, skip: systemQuit },
  ],
};
