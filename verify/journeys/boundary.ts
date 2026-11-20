import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import { z } from "zod";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";

const settleMs = 1_000;
const refusedAnswer = z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) });
const escapingPaths = [
  "app://satellite/%2e%2e/%2e%2e/package.json",
  "app://satellite/..%2f..%2fpackage.json",
  "app://satellite/..%5c..%5cpackage.json",
];

function openPages(page: Page): number {
  return (
    page
      .context()
      .browser()
      ?.contexts()
      .reduce((count, context) => count + context.pages().length, 0) ?? 0
  );
}

async function bridgeCode(page: Page, channel: string, payload: unknown): Promise<string> {
  const answer = await page.evaluate(
    async ([name, data]) => {
      const api: unknown = Reflect.get(window, "satellite");
      const invoke: unknown =
        typeof api === "object" && api !== null ? Reflect.get(api, "invoke") : undefined;
      if (typeof invoke !== "function") return "window.satellite.invoke is missing";
      const result: unknown = await Reflect.apply(invoke, api, [name, data]);
      return result;
    },
    [channel, payload],
  );
  const parsed = refusedAnswer.safeParse(answer);
  return parsed.success ? parsed.data.error.code : `answered ${JSON.stringify(answer)}`;
}

async function checkNoNode(page: Page): Promise<void> {
  const globals = await page.evaluate(() => ({
    require: typeof require,
    process: typeof process,
    module: typeof module,
    Buffer: typeof Buffer,
  }));
  for (const [name, type] of Object.entries(globals)) {
    assert.equal(type, "undefined", `the window can reach ${name}, its type is ${type}`);
  }
  const keys = await page.evaluate(() => {
    const api: unknown = Reflect.get(window, "satellite");
    return typeof api === "object" && api !== null ? Object.keys(api) : null;
  });
  assert.deepEqual(
    keys,
    ["invoke", "onEvent"],
    "window.satellite exposes more or less than invoke and onEvent",
  );
}

async function checkNavigation(page: Page, appUrl: string): Promise<void> {
  const pagesBefore = openPages(page);
  const opened = await page.evaluate(() => window.open("https://example.com") === null);
  assert.ok(opened, "window.open returned a window");
  await delay(settleMs);
  assert.equal(openPages(page), pagesBefore, "window.open made a new page");
  for (const target of ["https://example.com", "file:///"]) {
    await page
      .evaluate((url) => {
        location.assign(url);
      }, target)
      .catch(() => undefined);
    await delay(settleMs);
    assert.equal(page.url(), appUrl, `the window navigated to ${target}`);
  }
}

async function checkRequests(page: Page): Promise<void> {
  const remote = await page.evaluate(() =>
    fetch("https://example.com").then(
      () => "resolved",
      () => "rejected",
    ),
  );
  assert.equal(remote, "rejected", "a fetch of a remote address was not refused");
  for (const url of escapingPaths) {
    const status = await page.evaluate(
      (target) => fetch(target).then((response) => response.status),
      url,
    );
    assert.equal(status, 404, `${url} answered ${String(status)}, not 404`);
  }
  const microphone = await page.evaluate(() =>
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      () => "resolved",
      () => "rejected",
    ),
  );
  assert.equal(microphone, "rejected", "the microphone request was not refused");
  const notifications = await page.evaluate(() => Notification.requestPermission());
  assert.equal(notifications, "denied", "the notification permission was not denied");
}

async function checkBridge(page: Page): Promise<void> {
  assert.equal(
    await bridgeCode(page, "terminal.resize", { id: "x" }),
    "invalid-request",
    "terminal.resize with a bad payload was not refused as invalid-request",
  );
  assert.equal(
    await bridgeCode(page, "__proto__", {}),
    "unknown-channel",
    "the __proto__ channel was not refused as unknown-channel",
  );
}

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  const appUrl = page.url();
  await checkNoNode(page);
  await checkNavigation(page, appUrl);
  await checkRequests(page);
  await checkBridge(page);
  await session.screenshot("boundary");
}

export const boundaryJourney: Journey = { name: "boundary", scenario: "default", run };
