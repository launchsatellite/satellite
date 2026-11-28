import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { withoutGitVariables } from "../repo-recipe.ts";
import { gone, startClaude, terminalFocused, visible, waitUntil } from "./conditions.ts";

const waitMs = 15_000;
const commandModifier = process.platform === "darwin" ? "Meta" : "Control+Shift";
const execute = promisify(execFile);
const hostileProject = "beta‮lonrev";
const shownHostileProject = "beta[U+202E]lonrev";
const longName = "a-long-workspace-name-that-meets-the-strip-edge";

async function textIs(
  session: AppSession,
  testId: string,
  expected: string,
  when: string,
): Promise<void> {
  let shown = "";
  await waitUntil(
    async () => {
      const found = session.page.getByTestId(testId);
      shown = (await found.count()) === 0 ? "nothing" : (await found.innerText()).trim();
      shown = shown.replace(/\s+/g, " ");
      return shown === expected;
    },
    waitMs,
    () => `${testId} read "${shown}" instead of "${expected}" ${when}`,
  );
}

async function dragsIn(session: AppSession, testId: string): Promise<void> {
  const drag = await session.page.getByTestId(testId).getAttribute("data-drag");
  assert.equal(drag, "true", `${testId} is not a drag area`);
}

async function checkCommands(session: AppSession): Promise<void> {
  await visible(session, "nothing-selected", "with nothing selected");
  await dragsIn(session, "sidebar-top");
  await session.page.getByTestId("workspace-repo-hostile").click();
  await textIs(session, "workspace-title", "repo / hostile", "on the hostile workspace");
  await dragsIn(session, "workspace-header");
  await session.page.getByTestId("sidebar-new-workspace").click();
  await visible(session, "new-workspace-dialog", "after the New workspace button");
  await session.page.keyboard.press("Escape");
  await gone(session, "new-workspace-dialog", "after closing it");
  await session.page.getByTestId("open-command-menu").click();
  await visible(session, "palette", "after the command menu row");
  assert.equal(
    await session.page.getByTestId("sidebar-top").getAttribute("data-drag"),
    "false",
    "the sidebar's top row stayed a drag area under the command menu",
  );
  await session.page.keyboard.press("Escape");
  await gone(session, "palette", "after closing it");
  await session.page.keyboard.press(`${commandModifier}+P`);
  await session.page.getByTestId(`switch-repo-${longName}`).click();
  await textIs(session, "workspace-title", `repo / ${longName}`, "after the switcher");
}

async function checkInbox(session: AppSession): Promise<void> {
  await session.page.getByTestId("workspace-repo-main").click();
  await startClaude(session, 1);
  await session.page.keyboard.press("Enter");
  await session.page.getByTestId("workspace-repo-hostile").click();
  await textIs(session, "inbox-count", "1", "once main needed you");
  await session.screenshot("sidebar-needs-you");
  await session.page.getByTestId("inbox-repo-main").click();
  await textIs(session, "workspace-title", "repo", "after the Needs you row");
  await terminalFocused(session);
  await session.page.keyboard.type("y");
  await textIs(session, "inbox-count", "0", "once answered");
}

async function checkHostileProject(session: AppSession): Promise<void> {
  const folder = join(dirname(session.folder("x")), hostileProject);
  const env = { ...withoutGitVariables(process.env), ...session.gitEnv };
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "README.md"), "# Hostile\n");
  for (const args of [
    ["init", "-b", "main"],
    ["add", "."],
    ["commit", "-m", "first commit"],
  ]) {
    await execute("git", args, { cwd: folder, env });
  }
  await session.answerFolderDialog(folder);
  await session.page.keyboard.press(`${commandModifier}+O`);
  await visible(session, `workspace-${hostileProject}-main`, "after adding the hostile repo");
  await session.page.getByTestId(`workspace-${hostileProject}-main`).click();
  await textIs(session, "workspace-title", shownHostileProject, "on the hostile repo");
}

async function sidebarShown(session: AppSession): Promise<boolean> {
  return session.page.getByTestId("column-sidebar").isVisible();
}

async function checkSidebar(session: AppSession): Promise<void> {
  await session.page.getByTestId("sidebar-toggle").click();
  await waitUntil(async () => !(await sidebarShown(session)), waitMs, "the sidebar stayed");
  await waitUntil(
    async () => {
      const saved: unknown = JSON.parse(
        await readFile(join(session.home, "interface.json"), "utf8"),
      );
      return (
        typeof saved === "object" && saved !== null && Reflect.get(saved, "sidebar") === "hidden"
      );
    },
    waitMs,
    "interface.json never recorded the hidden sidebar",
  );
  await session.relaunch();
  await visible(session, "sidebar-toggle", "after the restart");
  assert.ok(!(await sidebarShown(session)), "the sidebar came back after a restart");
  if (process.platform === "darwin") {
    const box = await session.page.getByTestId("sidebar-toggle").boundingBox();
    assert.ok(
      box !== null && box.x >= 76,
      `the toggle sat at ${String(box?.x)}, under the traffic lights`,
    );
  }
  await session.page.getByTestId("sidebar-toggle").click();
  await waitUntil(() => sidebarShown(session), waitMs, "the button left it hidden");
}

export const frameJourney: Journey = {
  name: "frame",
  scenario: "title-bar",
  async run(session) {
    await visible(session, "sidebar-top", "at launch");
    await checkCommands(session);
    await checkInbox(session);
    await checkHostileProject(session);
    await checkSidebar(session);
    assert.deepEqual(session.consoleErrors, [], "the window logged console errors");
  },
};
