import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import { z } from "zod";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";

interface PolicyProbe {
  inlineScriptRan: boolean;
  dataFetch: string;
  remoteFetch: string;
  violations: string[];
}

const remote = "https://example.com";
const settleMs = 1_000;
const violationTimeoutMs = 10_000;
const policyDirectives = ["script-src-elem", "connect-src", "img-src", "frame-src"];
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
    `window.satellite should expose only invoke and onEvent, it exposes ${JSON.stringify(keys)}`,
  );
}

async function probePolicy(page: Page): Promise<PolicyProbe> {
  return page.evaluate(
    async ({ origin, directives, timeoutMs }) => {
      const violations = new Set<string>();
      addEventListener("securitypolicyviolation", (event) => {
        violations.add(event.effectiveDirective);
      });
      const script = document.createElement("script");
      script.textContent = "window.satelliteInlineScriptRan = true";
      document.head.append(script);
      script.remove();
      const settle = (request: Promise<unknown>) =>
        request.then(
          () => "resolved",
          () => "rejected",
        );
      const dataFetch = await settle(fetch("data:text/plain,satellite"));
      const remoteFetch = await settle(fetch(`${origin}/fetch`));
      const image = new Image();
      image.src = `${origin}/image.png`;
      const frame = document.createElement("iframe");
      frame.src = `${origin}/frame`;
      document.body.append(frame);
      const deadline = Date.now() + timeoutMs;
      while (!directives.every((directive) => violations.has(directive)) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      frame.remove();
      return {
        inlineScriptRan: Reflect.get(window, "satelliteInlineScriptRan") === true,
        dataFetch,
        remoteFetch,
        violations: [...violations],
      };
    },
    { origin: remote, directives: policyDirectives, timeoutMs: violationTimeoutMs },
  );
}

async function checkPolicy(page: Page): Promise<void> {
  const probe = await probePolicy(page);
  assert.ok(!probe.inlineScriptRan, "an inline script ran, so the content security policy is off");
  assert.equal(probe.dataFetch, "rejected", "a fetch of a data: address was not refused");
  assert.equal(probe.remoteFetch, "rejected", "a fetch of a remote address was not refused");
  for (const directive of policyDirectives) {
    assert.ok(
      probe.violations.includes(directive),
      `the content security policy reported no ${directive} refusal, only ${JSON.stringify(probe.violations)}`,
    );
  }
}

async function checkPermissions(page: Page): Promise<void> {
  const states = await page.evaluate(async () => ({
    microphone: (await navigator.permissions.query({ name: "microphone" })).state,
    camera: (await navigator.permissions.query({ name: "camera" })).state,
    notifications: Notification.permission,
    notificationRequest: await Notification.requestPermission(),
  }));
  for (const [permission, state] of Object.entries(states)) {
    assert.equal(state, "denied", `the ${permission} permission reads ${state}, not denied`);
  }
}

async function checkPaths(page: Page): Promise<void> {
  for (const url of escapingPaths) {
    const status = await page.evaluate(
      (target) => fetch(target).then((response) => response.status),
      url,
    );
    assert.equal(status, 404, `${url} answered ${String(status)}, not 404`);
  }
}

async function checkBridge(page: Page): Promise<void> {
  const invalid = await bridgeCode(page, "terminal.resize", { id: "x" });
  assert.equal(
    invalid,
    "invalid-request",
    `terminal.resize with a bad payload answered ${invalid}, not invalid-request`,
  );
  const unknown = await bridgeCode(page, "__proto__", {});
  assert.equal(
    unknown,
    "unknown-channel",
    `the __proto__ channel answered ${unknown}, not unknown-channel`,
  );
}

async function checkLeaving(page: Page, appUrl: string, reached: string[]): Promise<void> {
  const pagesBefore = openPages(page);
  const denied = await page.evaluate((url) => window.open(url) === null, `${remote}/window`);
  assert.ok(denied, "window.open returned a window");
  for (const target of [`${remote}/navigate`, "file:///"]) {
    await page
      .evaluate((url) => {
        location.assign(url);
      }, target)
      .catch(() => undefined);
  }
  await delay(settleMs);
  assert.deepEqual(reached, [], `the window reached ${reached.join(" and ")}`);
  assert.equal(openPages(page), pagesBefore, "window.open made a new page");
  assert.equal(page.url(), appUrl, `the window left the app for ${page.url()}`);
}

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  const appUrl = page.url();
  const reached: string[] = [];
  await page.context().route(`${remote}/**`, (route) => {
    reached.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "" });
  });
  await checkNoNode(page);
  await checkPolicy(page);
  await checkPermissions(page);
  await checkPaths(page);
  await checkBridge(page);
  await session.screenshot("boundary");
  await checkLeaving(page, appUrl, reached);
}

export const boundaryJourney: Journey = { name: "boundary", scenario: "default", run };
