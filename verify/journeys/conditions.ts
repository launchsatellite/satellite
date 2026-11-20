import { setTimeout as delay } from "node:timers/promises";
import type { AppSession } from "../driver.ts";

const pollMs = 100;

export const promptTimeoutMs = 60_000;
export const goneTimeoutMs = process.platform === "win32" ? 15_000 : 5_000;

export function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
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
  return pid;
}
