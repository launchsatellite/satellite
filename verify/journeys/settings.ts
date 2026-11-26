import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chooseOption, shownOption, type AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { gone, visible, waitUntil } from "./conditions.ts";

const waitMs = 15_000;
const settingsKeys = process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";
const securityAddress = "https://github.com/launchsatellite/satellite/security/policy";
const draculaGround = "#282a36";

async function checked(session: AppSession, testId: string): Promise<boolean> {
  return (await session.page.getByTestId(testId).getAttribute("aria-checked")) === "true";
}

async function shows(
  session: AppSession,
  theme: string,
  notifications: string,
  when: string,
): Promise<void> {
  await waitUntil(
    async () => (await shownOption(session.page, "settings-theme")) === theme,
    waitMs,
    `the theme did not read ${theme} ${when}`,
  );
  await waitUntil(
    () => checked(session, `settings-notifications-${notifications}`),
    waitMs,
    `notifications did not read ${notifications} ${when}`,
  );
}

async function saved(session: AppSession): Promise<{ theme: unknown; notifications: unknown }> {
  const state: unknown = JSON.parse(await readFile(join(session.home, "interface.json"), "utf8"));
  if (typeof state !== "object" || state === null) return { theme: null, notifications: null };
  return {
    theme: Reflect.get(state, "theme"),
    notifications: Reflect.get(state, "notifications"),
  };
}

async function draculaApplied(session: AppSession, when: string): Promise<void> {
  let read: { theme: string | null; ground: string } | undefined;
  await waitUntil(
    async () => {
      read = await session.page.evaluate(() => ({
        theme: document.documentElement.getAttribute("data-theme"),
        ground: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      }));
      return read.theme === "dracula" && read.ground.toLowerCase() === "#282a36";
    },
    waitMs,
    () =>
      `the window did not take Dracula's ground ${draculaGround} ${when}, it read ${JSON.stringify(read)}`,
  );
}

async function openSettings(session: AppSession): Promise<void> {
  await session.page.keyboard.press(settingsKeys);
  await visible(session, "settings-dialog", "after the settings shortcut");
}

async function ghChecks(session: AppSession): Promise<number> {
  return (await session.standInEvents()).filter(
    (event) => event.type === "start" && event.tool === "gh" && event.args.includes("--version"),
  ).length;
}

async function checkTools(session: AppSession): Promise<void> {
  await visible(session, "settings-check-count", "in the tools section");
  const rows = {
    "settings-check-git": /^Git\s+\d+\.\d+\S* found/,
    "settings-check-gh": /^GitHub CLI\s+Signed in as octo-verify/,
    "settings-check-claude": /^Claude Code\s+2\.1\.78 found/,
  };
  for (const [testId, pattern] of Object.entries(rows)) {
    const shown = await session.page.getByTestId(testId).innerText();
    assert.match(shown, pattern, `${testId} read ${shown}`);
  }
  const before = await ghChecks(session);
  await session.page.getByTestId("settings-check-again").click();
  await waitUntil(
    async () => (await ghChecks(session)) > before,
    waitMs,
    "Check again ran no second check of gh",
  );
}

async function checkSecurityLink(session: AppSession): Promise<void> {
  await session.page.getByTestId("settings-security").click();
  await visible(session, "link-dialog", "after Read the security policy");
  assert.equal(await session.page.getByTestId("link-address").innerText(), securityAddress);
  await session.page.getByTestId("link-open").click();
  await gone(session, "link-dialog", "after Open in browser");
  await waitUntil(
    async () => (await session.openedLinks()).includes(securityAddress),
    waitMs,
    "the security policy was not opened",
  );
  assert.deepEqual(await session.openedLinks(), [securityAddress]);
}

async function journey(session: AppSession): Promise<void> {
  await visible(session, "workspace-repo-main", "at launch");
  await openSettings(session);
  await shows(session, "Light", "on", "at launch");
  await checkTools(session);

  await chooseOption(session.page, "settings-theme", "Dracula");
  await session.page.getByTestId("settings-notifications-off").click();
  await shows(session, "Dracula", "off", "after choosing");
  await draculaApplied(session, "after choosing it");
  await waitUntil(
    async () => {
      const { theme, notifications } = await saved(session);
      return theme === "dracula" && notifications === false;
    },
    waitMs,
    "the choices were not saved",
  );
  await session.screenshot("settings-dracula");
  await checkSecurityLink(session);

  await session.page.keyboard.press("Escape");
  await gone(session, "settings-dialog", "before the relaunch");
  await session.relaunch();
  await visible(session, "workspace-repo-main", "after the relaunch");
  await draculaApplied(session, "after the relaunch");
  await session.page.getByTestId("workspace-repo-main").click();
  await openSettings(session);
  await shows(session, "Dracula", "off", "after the relaunch");

  await session.page.getByTestId("settings-show-guide").click();
  await gone(session, "settings-dialog", "after Show the guide");
  await visible(session, "guide-title", "after Show the guide in settings");
  assert.deepEqual(session.consoleErrors, [], "the window logged errors");
}

export const settingsJourney: Journey = {
  name: "settings",
  scenario: "settings",
  run: journey,
};
