import assert from "node:assert/strict";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { goneTimeoutMs, processGone, promptTimeoutMs, waitUntil } from "./conditions.ts";

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

export const quitJourney: Journey = { name: "quit", scenario: "flood", run };
