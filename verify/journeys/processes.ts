import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readProcessTable } from "../../src/main/platform/process-table.ts";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  bridgeCode,
  claudePids,
  goneTimeoutMs,
  gone,
  processGone,
  promptTimeoutMs,
  startClaude,
  visible,
  waitUntil,
} from "./conditions.ts";

interface Server {
  pid: number;
  port: number;
  child: number;
  seenAt: number;
}

const minimumAgeMs = 10_000;
const stopWaitMs = goneTimeoutMs + 3000;
const detachedSentence =
  "A process that detached from the session that started it keeps running and isn't listed here.";

async function startedServer(session: AppSession): Promise<Server> {
  let found: Server | undefined;
  await waitUntil(
    async () => {
      for (const event of await session.standInEvents()) {
        if (event.type === "server") {
          found = { pid: event.pid, port: event.port, child: event.child, seenAt: Date.now() };
        }
      }
      return found !== undefined;
    },
    promptTimeoutMs,
    "the stand-in's dev server never reported its port",
  );
  if (found === undefined) throw new Error("the stand-in logged no server");
  return found;
}

async function textOf(session: AppSession, testId: string): Promise<string> {
  return (await session.page.getByTestId(testId).textContent()) ?? "";
}

async function startOf(pid: number): Promise<number> {
  const started = (await readProcessTable()).find((entry) => entry.pid === pid)?.started;
  if (started === undefined || started === null) throw new Error(`no start for ${String(pid)}`);
  return started;
}

async function openList(session: AppSession): Promise<void> {
  await session.page.getByTestId("header-processes").click();
  await visible(session, "processes-dialog", "after the header count was pressed");
}

async function forged(
  session: AppSession,
  claudePid: number,
  stranger: { pid: number },
): Promise<void> {
  const { page } = session;
  const refusals: [string, string, unknown, string][] = [
    [
      "processes.stop",
      "the driver's own id with its true start",
      { pid: process.pid, started: await startOf(process.pid) },
      "not-found",
    ],
    [
      "processes.stop",
      "the session's own id with its true start",
      { pid: claudePid, started: await startOf(claudePid) },
      "not-found",
    ],
    [
      "processes.stop",
      "a process the journey started, outside every session, with its true start",
      { pid: stranger.pid, started: await startOf(stranger.pid) },
      "not-found",
    ],
    ["processes.stop", "an id of 1", { pid: 1, started: 1 }, "invalid-request"],
    ["processes.stop", "a negative id", { pid: -5, started: 1 }, "invalid-request"],
    [
      "processes.stop",
      "an extra signal",
      { pid: claudePid, started: 1, signal: "SIGKILL" },
      "invalid-request",
    ],
    [
      "processes.list",
      "a workspace field",
      { workspace: { projectId: "x", workspace: "main" } },
      "invalid-request",
    ],
  ];
  for (const [channel, what, payload, expected] of refusals) {
    assert.equal(await bridgeCode(page, channel, payload), expected, `${channel} with ${what}`);
  }
  assert.ok(!processGone(stranger.pid), "the unrelated process was ended by a forged request");
  assert.ok(!processGone(process.pid), "the driver was gone after the forged requests");
  assert.ok(!processGone(claudePid), "the stand-in was gone after the forged requests");
}

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  await page.getByTestId("workspace-repo-main").click();
  const claudePid = await startClaude(session, 1);
  const server = await startedServer(session);
  assert.ok(!processGone(server.pid), "the dev server was gone before it was listed");
  assert.ok(!processGone(server.child), "the dev server's child was gone before it was listed");
  assert.ok((await claudePids(session)).includes(claudePid), "the stand-in did not log its start");

  await delay(Math.max(0, server.seenAt + minimumAgeMs + 1000 - Date.now()));
  await page.keyboard.press("Enter");
  await visible(
    session,
    "header-processes",
    "after a turn ended with the server older than 10 seconds",
  );
  assert.equal(await page.getByTestId("header-processes").getAttribute("data-count"), "1");
  await waitUntil(
    async () => (await textOf(session, "workspace-repo-main-processes")).trim() === "1",
    promptTimeoutMs,
    "the workspace row did not read 1 running process",
  );

  await openList(session);
  assert.equal(await page.locator("[data-testid^='process-row-'][data-pid]").count(), 1);
  const command = await textOf(session, "process-row-0-command");
  assert.ok(command.includes("dev-server"), `the row's command read ${JSON.stringify(command)}`);
  assert.equal((await textOf(session, "process-row-0-session")).trim(), "Session 1");
  assert.notEqual((await textOf(session, "process-row-0-age")).trim(), "", "the age was empty");
  const port = page.getByTestId(`process-row-0-port-${String(server.port)}`);
  assert.equal((await port.textContent())?.trim(), `:${String(server.port)}`);
  assert.equal(await port.getAttribute("data-link"), "true");
  assert.equal((await textOf(session, "processes-note")).trim(), detachedSentence);
  await session.screenshot("processes");

  await port.click();
  await visible(session, "link-dialog", "after the port was pressed");
  const address = `http://127.0.0.1:${String(server.port)}/`;
  assert.equal((await textOf(session, "link-address")).trim(), address);
  await page.getByTestId("link-open").click();
  await waitUntil(
    async () => (await session.openedLinks()).length > 0,
    promptTimeoutMs,
    "the confirmed open recorded no address",
  );
  assert.deepEqual(await session.openedLinks(), [address]);

  await gone(session, "link-dialog", "after the address opened");
  await openList(session);
  assert.equal(
    await bridgeCode(page, "processes.stop", {
      pid: server.pid,
      started: (await startOf(server.pid)) + 1000,
    }),
    "not-found",
    "a listed process with a start one second off was accepted",
  );
  assert.ok(!processGone(server.pid), "the dev server ended for a start one second off");
  await page.getByTestId("process-row-0-stop").click();
  await waitUntil(
    () => processGone(server.pid) && processGone(server.child),
    stopWaitMs,
    () =>
      `after Stop the dev server ${processGone(server.pid) ? "was gone" : "still ran"} and its child ${processGone(server.child) ? "was gone" : "still ran"}`,
  );
  assert.ok(!processGone(claudePid), "Stop ended the stand-in Claude Code too");
  await visible(session, "processes-empty", "after Stop", stopWaitMs);
  await page.getByTestId("processes-close").click();
  await gone(session, "header-processes", "after the process ended");
  await waitUntil(
    () =>
      page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") === "workspace-header",
      ),
    promptTimeoutMs,
    "focus did not return to the workspace header once the list closed and its opener was gone",
  );

  const stranger = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: "ignore",
  });
  try {
    await waitUntil(
      async () =>
        stranger.pid !== undefined &&
        (await readProcessTable()).some((entry) => entry.pid === stranger.pid),
      promptTimeoutMs,
      "the unrelated process never showed in the table",
    );
    await forged(session, claudePid, { pid: stranger.pid ?? 0 });
  } finally {
    stranger.kill();
  }
  assert.deepEqual(session.consoleErrors, [], "the window logged errors");
}

export const processesJourney: Journey = { name: "processes", scenario: "dev-server", run };
