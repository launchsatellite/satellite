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
const hostileProject = "beta\u202elonrev";
const shownHostileProject = "beta[U+202E]lonrev";

async function unavailable(session: AppSession, testId: string): Promise<boolean> {
  return (await session.page.getByTestId(testId).getAttribute("aria-disabled")) === "true";
}

async function placeReads(session: AppSession, expected: string, when: string): Promise<void> {
  let shown = "";
  await waitUntil(
    async () => {
      shown = (await session.page.getByTestId("title-place").innerText()).replace(/\s+/g, " ");
      return shown === expected;
    },
    waitMs,
    () => `the centre title read "${shown}" instead of "${expected}" ${when}`,
  );
}

async function checkCommands(session: AppSession): Promise<void> {
  await placeReads(session, "Satellite", "with nothing selected");
  await session.page.getByTestId("workspace-repo-hostile").click();
  await placeReads(session, "repo / hostile", "on the hostile workspace");
  await session.page.getByTestId("title-new-workspace").click();
  await visible(session, "new-workspace-dialog", "after the New workspace button");
  await session.page.keyboard.press("Escape");
  await gone(session, "new-workspace-dialog", "after closing it");
  await session.page.getByTestId("title-commands").click();
  await visible(session, "palette", "after the command menu button");
  await session.page.keyboard.press("Escape");
  await gone(session, "palette", "after closing it");
  await session.page.getByTestId("title-place").click();
  await visible(session, "switch-repo-main", "after a click on the centre title");
  await session.page
    .getByTestId("switch-repo-a-long-workspace-name-that-meets-the-strip-edge")
    .click();
  await placeReads(
    session,
    "repo / a-long-workspace-name-that-meets-the-strip-edge",
    "after the switcher",
  );
}

async function checkInbox(session: AppSession): Promise<void> {
  await session.page.getByTestId("workspace-repo-main").click();
  await startClaude(session, 1);
  await session.page.keyboard.press("Enter");
  await session.page.getByTestId("workspace-repo-hostile").click();
  await waitUntil(
    async () => !(await unavailable(session, "title-inbox")),
    waitMs,
    "the inbox button stayed unavailable once main needed you",
  );
  await session.screenshot("strip-needs-you");
  await session.page.getByTestId("title-inbox").click();
  await placeReads(session, "repo", "after the inbox button");
  await terminalFocused(session);
  await session.page.keyboard.type("y");
  await waitUntil(
    () => unavailable(session, "title-inbox"),
    waitMs,
    "the inbox button stayed available once answered",
  );
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
  await visible(session, `workspace-${hostileProject}-main`, "after adding the hostile project");
  await session.page.getByTestId(`workspace-${hostileProject}-main`).click();
  await placeReads(session, shownHostileProject, "on the hostile project");
}

async function sidebarShown(session: AppSession): Promise<boolean> {
  return session.page.getByTestId("column-sidebar").isVisible();
}

async function checkSidebar(session: AppSession): Promise<void> {
  await session.page.getByTestId("title-sidebar").click();
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
  await visible(session, "title-bar", "after the restart");
  assert.ok(!(await sidebarShown(session)), "the sidebar came back after a restart");
  await session.page.getByTestId("title-sidebar").click();
  await waitUntil(() => sidebarShown(session), waitMs, "the button left it hidden");
}

export const titleBarJourney: Journey = {
  name: "title-bar",
  scenario: "title-bar",
  async run(session) {
    await visible(session, "title-bar", "at launch");
    await checkCommands(session);
    await checkInbox(session);
    await checkHostileProject(session);
    await checkSidebar(session);
    assert.deepEqual(session.consoleErrors, [], "the window logged console errors");
  },
};
