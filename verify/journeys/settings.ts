import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { gone, visible, waitUntil } from "./conditions.ts";

const waitMs = 15_000;
const mac = process.platform === "darwin";
const commandModifier = mac ? "Meta" : "Control+Shift";
const settingsKeys = mac ? "Meta+Comma" : "Control+Comma";
const repositoryAddress = "https://github.com/launchsatellite/satellite";
const securityAddress = `${repositoryAddress}/security/policy`;

function keys(key: string, ctrlAlone = false): string {
  if (mac) return `⌘${key}`;
  return ctrlAlone ? `Ctrl+${key}` : `Ctrl+Shift+${key}`;
}

const shortcuts = [
  ["Open the command menu", keys("K")],
  ["Add a project", keys("O")],
  ["New workspace", keys("N")],
  ["New Claude Code session", keys("T")],
  ["Go to a workspace", keys("P")],
  ["Hide the sidebar", keys("B")],
  ["Open settings", keys(",", true)],
  ["Go to the next unresolved thread", keys("J")],
  ["Open a file by name", keys("F")],
  ["Send the selected lines to Claude Code", keys("L")],
];

async function focusedTestId(session: AppSession): Promise<string | null> {
  return session.page.evaluate(
    () => document.activeElement?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
  );
}

async function focusReturns(session: AppSession, testId: string, when: string): Promise<void> {
  let found: string | null = null;
  await waitUntil(
    async () => {
      found = await focusedTestId(session);
      return found === testId;
    },
    waitMs,
    () => `focus was on ${String(found)} instead of ${testId} ${when}`,
  );
}

async function checked(session: AppSession, testId: string): Promise<boolean> {
  return (await session.page.getByTestId(testId).getAttribute("aria-checked")) === "true";
}

async function shows(
  session: AppSession,
  theme: string,
  notifications: string,
  when: string,
): Promise<void> {
  assert.ok(
    await checked(session, `settings-theme-${theme}`),
    `the theme was not ${theme} ${when}`,
  );
  assert.ok(
    await checked(session, `settings-notifications-${notifications}`),
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

async function looksDark(session: AppSession): Promise<boolean> {
  return session.page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
}

async function openSettings(session: AppSession, how: "button" | "keys" | "command") {
  if (how === "button") await session.page.getByTestId("title-settings").click();
  if (how === "keys") await session.page.keyboard.press(settingsKeys);
  if (how === "command") {
    await session.page.keyboard.press(`${commandModifier}+K`);
    await visible(session, "palette", "after the command menu shortcut");
    await session.page.getByTestId("command-settings-show").click();
  }
  await visible(session, "settings-dialog", `after opening settings by ${how}`);
}

async function closeSettings(session: AppSession, returnTo: string, when: string): Promise<void> {
  await session.page.keyboard.press("Escape");
  await gone(session, "settings-dialog", `after Escape ${when}`);
  await focusReturns(session, returnTo, `after Escape ${when}`);
}

async function runCommand(session: AppSession, id: string): Promise<void> {
  await session.page.keyboard.press(`${commandModifier}+K`);
  await visible(session, "palette", "after the command menu shortcut");
  await session.page.getByTestId(`command-${id}`).click();
  await gone(session, "palette", `after running ${id}`);
}

async function checkEntryPoints(session: AppSession): Promise<void> {
  const button = session.page.getByTestId("title-settings");
  assert.equal(await button.getAttribute("aria-label"), "Open settings");
  assert.equal(await button.getAttribute("title"), `Open settings ${keys(",", true)}`);
  await session.page.getByTestId("workspace-repo-main").click();
  await session.page.getByTestId("workspace-repo-main").focus();
  await openSettings(session, "keys");
  const inside = await session.page.evaluate(
    () => document.querySelector("[role='dialog']")?.contains(document.activeElement) === true,
  );
  assert.ok(inside, "focus did not move into settings");
  assert.equal(await session.page.getByTestId("title-bar").getAttribute("data-drag"), "false");
  await shows(session, "light", "on", "at launch");
  await closeSettings(session, "workspace-repo-main", "from the shortcut");
  await openSettings(session, "button");
  await session.page.getByTestId("settings-done").click();
  await gone(session, "settings-dialog", "after Done");
  await focusReturns(session, "title-settings", "after Done");
  await session.page.getByTestId("workspace-repo-main").focus();
  await openSettings(session, "command");
  await closeSettings(session, "workspace-repo-main", "from the command menu");
  await session.page.keyboard.press(`${commandModifier}+K`);
  await visible(session, "palette", "before the shortcut over the command menu");
  await openSettings(session, "keys");
  await gone(session, "palette", "once settings opened over it");
  await closeSettings(session, "workspace-repo-main", "from the shortcut over the command menu");
}

async function checkTools(session: AppSession): Promise<void> {
  await visible(session, "settings-check-count", "in the tools section");
  const rows = {
    "settings-check-git": " found",
    "settings-check-gh": "Signed in as octo-verify",
    "settings-check-claude": "2.1.78 found",
  };
  for (const [testId, text] of Object.entries(rows)) {
    const shown = await session.page.getByTestId(testId).innerText();
    assert.ok(shown.includes(text), `${testId} read ${shown}`);
  }
  assert.ok(
    (await session.page.getByTestId("settings-check-count").innerText()).startsWith("03 / 03"),
  );
  await session.page.getByTestId("settings-check-again").click();
  await visible(session, "settings-check-count", "after Check again");
}

async function checkShortcuts(session: AppSession): Promise<void> {
  const listed = await session.page
    .locator("[data-testid^='settings-shortcut-']")
    .evaluateAll((rows) =>
      rows.map((row) => [
        row.querySelector("span")?.textContent ?? "",
        row.querySelector("kbd")?.textContent ?? "",
      ]),
    );
  assert.deepEqual(listed, shortcuts, "the shortcut list did not match the commands");
}

async function checkChoices(session: AppSession): Promise<void> {
  assert.ok(!(await looksDark(session)), "the window was dark before any choice");
  await session.page.getByTestId("settings-theme-dark").click();
  await waitUntil(() => looksDark(session), waitMs, "the window stayed light after Dark");
  await session.page.getByTestId("settings-notifications-off").click();
  await shows(session, "dark", "off", "after choosing");
  await waitUntil(
    async () => {
      const { theme, notifications } = await saved(session);
      return theme === "dark" && notifications === false;
    },
    waitMs,
    "the choices were not saved",
  );
  await session.screenshot("settings-dark");
}

async function checkLinks(session: AppSession): Promise<void> {
  await session.page.getByTestId("settings-repository").click();
  await visible(session, "link-dialog", "after Open the repository");
  assert.equal(await session.page.getByTestId("link-address").innerText(), repositoryAddress);
  await session.page.getByTestId("link-cancel").click();
  await gone(session, "link-dialog", "after Cancel");
  await focusReturns(session, "settings-repository", "after cancelling the link");
  await visible(session, "settings-dialog", "after cancelling the link");
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

async function fitsSmall(session: AppSession, theme: string): Promise<void> {
  const dialog = await session.page.getByTestId("settings-dialog").boundingBox();
  const done = await session.page.getByTestId("settings-done").boundingBox();
  const button = await session.page.getByTestId("title-settings").boundingBox();
  assert.ok(
    dialog !== null && dialog.x >= 0 && dialog.x + dialog.width <= 960 && dialog.y >= 0,
    `settings ran out of the window at 960 by 600 in ${theme}`,
  );
  assert.ok(
    done !== null &&
      done.y + done.height <= dialog.y + dialog.height &&
      done.y + done.height <= 600,
    `Done was out of view at 960 by 600 in ${theme}`,
  );
  assert.ok(
    button !== null &&
      button.y >= 0 &&
      button.y + button.height <= 40 &&
      button.x + button.width <= 960,
    `the settings button left the title bar at 960 by 600 in ${theme}`,
  );
  await session.page.getByTestId("settings-about").scrollIntoViewIfNeeded();
  await visible(session, "settings-version", `in the about section in ${theme}`);
  await session.screenshot(`settings-small-${theme}`);
}

async function checkSmall(session: AppSession): Promise<void> {
  await session.page.setViewportSize({ width: 960, height: 600 });
  await fitsSmall(session, "dark");
  await session.page.getByTestId("settings-theme-light").click();
  await waitUntil(async () => !(await looksDark(session)), waitMs, "the window stayed dark");
  await fitsSmall(session, "light");
  await session.page.getByTestId("settings-theme-dark").click();
  await waitUntil(() => looksDark(session), waitMs, "the window stayed light");
  await session.page.setViewportSize({ width: 1440, height: 900 });
}

async function checkRelaunch(session: AppSession): Promise<void> {
  await session.page.keyboard.press("Escape");
  await gone(session, "settings-dialog", "before the relaunch");
  await session.relaunch();
  await visible(session, "title-settings", "after the relaunch");
  assert.ok(await looksDark(session), "the dark theme did not survive the relaunch");
  await session.page.keyboard.press(`${commandModifier}+K`);
  await visible(session, "command-notifications-on", "in the command menu with notifications off");
  assert.equal(await session.page.getByTestId("command-notifications-off").count(), 0);
  await session.page.keyboard.press("Escape");
  await gone(session, "palette", "after Escape");
  await openSettings(session, "button");
  await shows(session, "dark", "off", "after the relaunch");
  await session.page.keyboard.press("Escape");
  await gone(session, "settings-dialog", "after the relaunch");
  await runCommand(session, "theme-light");
  await runCommand(session, "notifications-on");
  await waitUntil(async () => !(await looksDark(session)), waitMs, "Use the light theme failed");
  await openSettings(session, "button");
  await shows(session, "light", "on", "after the commands");
}

async function checkGuide(session: AppSession): Promise<void> {
  await session.page.getByTestId("settings-show-guide").click();
  await gone(session, "settings-dialog", "after Show the guide");
  await visible(session, "guide-title", "after Show the guide in settings");
}

async function journey(session: AppSession): Promise<void> {
  await visible(session, "workspace-repo-main", "at launch");
  await checkEntryPoints(session);
  await openSettings(session, "button");
  await checkTools(session);
  await checkShortcuts(session);
  await session.screenshot("settings-light");
  await checkChoices(session);
  await checkLinks(session);
  await checkSmall(session);
  await checkRelaunch(session);
  await checkGuide(session);
  assert.deepEqual(session.consoleErrors, [], "the window logged errors");
}

export const settingsJourney: Journey = {
  name: "settings",
  scenario: "settings",
  run: journey,
};
