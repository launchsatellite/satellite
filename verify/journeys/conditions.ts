import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import { z } from "zod";
import { isProcessAlive, type AppSession } from "../driver.ts";

const pollMs = 100;
const refusedAnswer = z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) });
const shownTimeoutMs = 15_000;

export const promptTimeoutMs = 60_000;
export const goneTimeoutMs = process.platform === "win32" ? 15_000 : 5_000;

export function processGone(pid: number): boolean {
  return !isProcessAlive(pid);
}

export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
  failure: string | (() => string),
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() >= deadline) {
      const reason = typeof failure === "string" ? failure : failure();
      throw new Error(`${reason} within ${String(timeoutMs / 1000)} seconds`);
    }
    await delay(pollMs);
  }
}

export async function claudePids(session: AppSession): Promise<number[]> {
  return (await session.standInEvents()).flatMap((event) =>
    event.type === "start" && event.tool === "claude" ? [event.pid] : [],
  );
}

export async function startClaude(session: AppSession, count: number): Promise<number> {
  await session.page.getByTestId("start-claude").click();
  let pid: number | undefined;
  await waitUntil(
    async () => {
      pid = (await claudePids(session))[count - 1];
      const text = await session.page.getByTestId("terminal").textContent();
      return pid !== undefined && text?.includes("Claude Code stand-in") === true;
    },
    promptTimeoutMs,
    "Claude Code stand-in did not appear in the terminal",
  );
  if (pid === undefined) throw new Error("the stand-in logged no start");
  await terminalFocused(session);
  return pid;
}

export async function terminalFocused(session: AppSession): Promise<void> {
  await waitUntil(
    () =>
      session.page.evaluate(
        () => (document.activeElement?.closest('[data-testid="terminal"]') ?? null) !== null,
      ),
    promptTimeoutMs,
    "the terminal never took focus",
  );
}

export async function toastReads(
  session: AppSession,
  expected: string,
  when: string,
): Promise<void> {
  const toast = session.page.getByTestId("toast");
  let shown = "";
  await waitUntil(
    async () => {
      shown = (await toast.count()) === 0 ? "" : await toast.innerText();
      return shown.includes(expected);
    },
    shownTimeoutMs,
    () => `${when} the toast read "${shown}" instead of "${expected}"`,
  );
}

export async function gone(session: AppSession, testId: string, when: string): Promise<void> {
  await waitUntil(
    async () => (await session.page.getByTestId(testId).count()) === 0,
    shownTimeoutMs,
    `${testId} was still listed ${when}`,
  );
}

export async function visible(
  session: AppSession,
  testId: string,
  when: string,
  timeoutMs = shownTimeoutMs,
): Promise<void> {
  await session.page
    .getByTestId(testId)
    .waitFor({ timeout: timeoutMs })
    .catch(() => {
      throw new Error(`${testId} did not appear ${when}`);
    });
}

export async function stateIs(
  session: AppSession,
  testId: string,
  expected: string,
  when: string,
): Promise<void> {
  const element = session.page.getByTestId(testId);
  let read: string | null = null;
  await waitUntil(
    async () => {
      read = (await element.count()) === 0 ? null : await element.getAttribute("data-state");
      return read === expected;
    },
    promptTimeoutMs,
    () => `${testId} read ${JSON.stringify(read)} instead of ${expected} ${when}`,
  );
}

export async function standInInput(session: AppSession, from = 0): Promise<string> {
  return (await session.standInEvents())
    .slice(from)
    .flatMap((event) => (event.type === "input" ? [event.data] : []))
    .join("");
}

export async function hooksAnswered(session: AppSession, name: string): Promise<number> {
  return (await session.standInEvents()).filter(
    (event) => event.type === "hook" && event.event === name && event.status === 204,
  ).length;
}

export async function settingsFileOf(session: AppSession, pid: number): Promise<string> {
  const start = (await session.standInEvents()).find(
    (event) => event.type === "start" && event.pid === pid,
  );
  const args = start?.type === "start" ? start.args : [];
  const file = args[args.indexOf("--settings") + 1];
  if (!args.includes("--settings") || file === undefined) {
    throw new Error(`the stand-in ${String(pid)} started without --settings`);
  }
  return file;
}

export async function bridgeAnswer(
  page: Page,
  channel: string,
  payload: unknown,
): Promise<unknown> {
  return page.evaluate(
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
}

export async function bridgeCode(page: Page, channel: string, payload: unknown): Promise<string> {
  const answer = await bridgeAnswer(page, channel, payload);
  const parsed = refusedAnswer.safeParse(answer);
  return parsed.success ? parsed.data.error.code : `answered ${JSON.stringify(answer)}`;
}
