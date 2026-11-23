import assert from "node:assert/strict";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  claudePids,
  goneTimeoutMs,
  hooksAnswered,
  processGone,
  promptTimeoutMs,
  stateIs,
  startClaude,
  waitUntil,
} from "./conditions.ts";

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
  await session.screenshot("quit");
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
  if (process.platform === "win32") return;
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
    ["1 Claude Code session is mid-task"],
    `quitting with one working and one idle session asked ${JSON.stringify(asked)}`,
  );
  await waitUntil(
    () => pids.every(processGone),
    goneTimeoutMs,
    "a stand-in outlived the quit that asked",
  );
}

export const quitJourney: Journey = {
  name: "quit",
  scenario: "flood",
  run,
  then: [{ name: "quit", scenario: "needs-permission", run: asksOnlyWhileUnfinished }],
};
