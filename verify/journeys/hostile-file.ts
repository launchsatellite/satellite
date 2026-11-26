import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { gone, visible, waitUntil } from "./conditions.ts";

const waitMs = 15_000;
const settingsKeys = process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";
const unbroken = `${"_".repeat(9000)}!`;
const slowest = `x = ${"a.".repeat(98)}`;

function hostileText(): string {
  const lines: string[] = [];
  for (let at = 0; at < 100; at++) lines.push(unbroken, slowest, slowest);
  return `${lines.join("\n")}\n`;
}

async function journey(session: AppSession): Promise<void> {
  const { page } = session;
  await writeFile(
    join(session.home, "worktrees", "repo", "feature", "src", "hostile.ts"),
    hostileText(),
  );
  await page.getByTestId("workspace-repo-feature").click();
  await page.getByTestId("changes-list").getByText("hostile.ts").click();
  await waitUntil(
    () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".view-line")].some((line) =>
          line.textContent.includes("a.a.a.a."),
        ),
      ),
    waitMs,
    "the diff of hostile.ts never showed its lines",
  );
  await page.keyboard.press(settingsKeys);
  await visible(session, "settings-dialog", "after the settings shortcut on a hostile file");
  await page.keyboard.press("Escape");
  await gone(session, "settings-dialog", "after Escape");
}

export const hostileFileJourney: Journey = {
  name: "hostile-file",
  scenario: "hostile-file",
  run: journey,
};
