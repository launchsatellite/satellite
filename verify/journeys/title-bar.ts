import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { withoutGitVariables } from "../repo-recipe.ts";
import { gone, startClaude, terminalFocused, visible, waitUntil } from "./conditions.ts";

const waitMs = 15_000;
const commandModifier = process.platform === "darwin" ? "Meta" : "Control+Shift";
const shortcut = process.platform === "darwin" ? "⌘" : "Ctrl+Shift+";
const expectedFrame = process.platform === "darwin" ? "inset" : "overlay";
const execute = promisify(execFile);
const hostileProject = "beta\u202elonrev";
const shownHostileProject = "beta[U+202E]lonrev";

async function attribute(session: AppSession, testId: string, name: string): Promise<string> {
  return (await session.page.getByTestId(testId).getAttribute(name)) ?? "";
}

async function unavailable(session: AppSession, testId: string): Promise<boolean> {
  return (await attribute(session, testId, "aria-disabled")) === "true";
}

async function dragRegions(session: AppSession): Promise<{ strip: string; controls: string[] }> {
  return session.page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>("[data-testid='title-bar']");
    if (strip === null) return { strip: "missing", controls: [] };
    const region = (element: Element) => getComputedStyle(element).getPropertyValue("app-region");
    const controls = [...strip.querySelectorAll("button")].map((button) =>
      region(button.closest("span") ?? button),
    );
    return { strip: region(strip), controls };
  });
}

async function dragsWhen(session: AppSession, drags: boolean, when: string): Promise<void> {
  await waitUntil(
    async () => (await attribute(session, "title-bar", "data-drag")) === String(drags),
    waitMs,
    `the strip ${drags ? "was not" : "stayed"} a drag area ${when}`,
  );
  const { strip } = await dragRegions(session);
  assert.equal(strip, drags ? "drag" : "none", `the strip's app-region read ${strip} ${when}`);
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

async function checkStrip(session: AppSession): Promise<void> {
  assert.equal(await attribute(session, "title-bar", "data-frame"), expectedFrame);
  await placeReads(session, "Satellite", "with nothing selected");
  assert.equal(
    await session.page.getByTestId("title-place").evaluate((element) => element.tagName),
    "SPAN",
    "the centre title was a control with nothing selected",
  );
  await dragsWhen(session, true, "at launch");
  const { controls } = await dragRegions(session);
  assert.deepEqual(
    controls,
    controls.map(() => "no-drag"),
    `a control in the strip sat inside the drag area, ${controls.join(", ")}`,
  );
  const named = {
    "title-sidebar": ["Hide the sidebar", `Hide the sidebar ${shortcut}B`],
    "title-inbox": ["0 workspaces need you", "0 workspaces need you"],
    "title-commands": ["Open the command menu", `Open the command menu ${shortcut}K`],
    "title-new-workspace": ["New workspace", `New workspace ${shortcut}N`],
  };
  for (const [testId, [label, tooltip]] of Object.entries(named)) {
    assert.equal(await attribute(session, testId, "aria-label"), label, `${testId} name`);
    assert.equal(await attribute(session, testId, "title"), tooltip, `${testId} tooltip`);
  }
  assert.ok(await unavailable(session, "title-inbox"), "the inbox ran with nothing listed");
  assert.ok(await unavailable(session, "title-new-workspace"), "New workspace ran with no project");
  assert.ok(!(await unavailable(session, "title-commands")), "the command menu was unavailable");
  await session.page.getByTestId("title-new-workspace").click({ force: true });
  assert.equal(await session.page.getByTestId("new-workspace-dialog").count(), 0);
  await session.page.getByTestId("title-commands").click();
  await visible(session, "palette", "after the command menu button");
  await dragsWhen(session, false, "under the command menu");
  await session.page.keyboard.press("Escape");
  await gone(session, "palette", "after Escape");
  await dragsWhen(session, true, "once the command menu closed");
  await session.screenshot("strip-nothing-selected");
}

async function checkPlace(session: AppSession): Promise<void> {
  await session.page.getByTestId("workspace-repo-hostile").click();
  await placeReads(session, "repo / hostile", "on the hostile workspace");
  const heading = session.page.getByRole("heading", { level: 1 });
  assert.equal((await heading.innerText()).replace(/\s+/g, " ").trim(), "repo / hostile");
  const box = await heading.boundingBox();
  assert.ok(box !== null && box.width <= 1, "the header's heading was drawn on screen");
  const header = await session.page.getByTestId("workspace-header").evaluate((element) =>
    [...element.children]
      .filter((child) => child.tagName !== "H1")
      .map((child) => (child instanceof HTMLElement ? child.innerText : ""))
      .join(" "),
  );
  assert.ok(
    header.includes("fix-[U+202E]nigol") && !header.includes("repo") && !header.includes("hostile"),
    `the workspace header did not name only the branch, ${header}`,
  );
  assert.ok(
    !(await unavailable(session, "title-new-workspace")),
    "New workspace stayed unavailable",
  );
  await session.page.getByTestId("title-new-workspace").click();
  await visible(session, "new-workspace-dialog", "after the New workspace button");
  await dragsWhen(session, false, "under a dialog");
  await session.page.keyboard.press("Escape");
  await gone(session, "new-workspace-dialog", "after closing it");
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
  await session.screenshot("strip-long-name");
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
  assert.equal(
    await attribute(session, "title-inbox", "aria-label"),
    "1 workspace needs you, go to the newest",
  );
  assert.equal(await session.page.getByTestId("title-inbox").innerText(), "1");
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

async function sidebarShown(session: AppSession): Promise<boolean> {
  return session.page.getByTestId("column-projects").isVisible();
}

async function checkSidebar(session: AppSession): Promise<void> {
  const before = await session.page.getByTestId("column-repository").boundingBox();
  await session.page.getByTestId("workspace-repo-main").focus();
  await session.page.keyboard.press(`${commandModifier}+B`);
  await waitUntil(async () => !(await sidebarShown(session)), waitMs, "the sidebar stayed");
  await waitUntil(
    () =>
      session.page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") === "title-sidebar",
      ),
    waitMs,
    "focus did not move to the toggle when its column hid",
  );
  assert.equal(await attribute(session, "title-sidebar", "aria-expanded"), "false");
  assert.equal(await attribute(session, "title-sidebar", "aria-label"), "Show the sidebar");
  const after = await session.page.getByTestId("column-repository").boundingBox();
  assert.ok(
    before !== null && after !== null && after.x === 0 && after.width > before.width,
    "the centre column did not take the sidebar's width",
  );
  await session.screenshot("sidebar-hidden");
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
  await session.page.keyboard.press(`${commandModifier}+K`);
  await session.page.keyboard.type("Focus the sidebar");
  await session.page.keyboard.press("Enter");
  await waitUntil(() => sidebarShown(session), waitMs, "Focus the sidebar left it hidden");
  await waitUntil(
    () =>
      session.page.evaluate(
        () => document.activeElement?.closest("[data-testid='column-projects']") != null,
      ),
    waitMs,
    "Focus the sidebar did not put focus in it",
  );
  await session.page.getByTestId("title-sidebar").click();
  await waitUntil(async () => !(await sidebarShown(session)), waitMs, "the button left it shown");
  await session.page.getByTestId("title-sidebar").click();
  await waitUntil(() => sidebarShown(session), waitMs, "the button left it hidden");
}

async function checkSizes(session: AppSession): Promise<void> {
  await session.page.getByTestId("workspace-repo-hostile").click();
  for (const theme of ["light", "dark"] as const) {
    await session.page.emulateMedia({ colorScheme: theme });
    await session.page.setViewportSize({ width: 960, height: 600 });
    const strip = await session.page.getByTestId("title-bar").boundingBox();
    assert.ok(strip !== null && strip.height === 40, "the strip was not 40 pixels tall");
    for (const testId of [
      "title-sidebar",
      "title-place",
      "title-inbox",
      "title-commands",
      "title-new-workspace",
    ]) {
      const box = await session.page.getByTestId(testId).boundingBox();
      assert.ok(
        box !== null && box.x >= 0 && box.x + box.width <= 960 && box.width > 0,
        `${testId} left the strip at 960 by 600 in ${theme}`,
      );
    }
    await session.screenshot(`strip-small-${theme}`);
    await session.page.setViewportSize({ width: 1440, height: 900 });
    await session.screenshot(`strip-${theme}`);
  }
}

interface StripLayout {
  toggle: Box;
  place: Box;
  inbox: Box;
  clipped: boolean;
  hits: Record<string, boolean>;
  dragGaps: boolean[];
}
interface Box {
  left: number;
  right: number;
}

function readStrip(): StripLayout {
  const byTestId = (testId: string) => {
    const element = document.querySelector<HTMLElement>(`[data-testid='${testId}']`);
    if (element === null) throw new Error(`${testId} is missing`);
    return element;
  };
  const edges = (element: HTMLElement): Box => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  };
  const strip = byTestId("title-bar");
  const middle = strip.getBoundingClientRect().top + strip.getBoundingClientRect().height / 2;
  const hits = Object.fromEntries(
    ["title-sidebar", "title-inbox", "title-commands", "title-new-workspace"].map((testId) => {
      const box = byTestId(testId).getBoundingClientRect();
      const found = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return [testId, found?.closest("[data-testid]")?.getAttribute("data-testid") === testId];
    }),
  );
  const drags = (x: number) => {
    let element = document.elementFromPoint(x, middle);
    if (element === null || !strip.contains(element)) return false;
    while (element !== null && element !== strip) {
      if (getComputedStyle(element).getPropertyValue("app-region") === "no-drag") return false;
      element = element.parentElement;
    }
    return getComputedStyle(strip).getPropertyValue("app-region") === "drag";
  };
  const toggle = edges(byTestId("title-sidebar"));
  const place = edges(byTestId("title-place"));
  const inbox = edges(byTestId("title-inbox"));
  const clipped = [...byTestId("title-place").querySelectorAll("span")].some(
    (span) => span.scrollWidth > span.clientWidth,
  );
  return {
    toggle,
    place,
    inbox,
    clipped,
    hits,
    dragGaps: [drags((toggle.right + place.left) / 2), drags((place.right + inbox.left) / 2)],
  };
}

async function checkLongName(session: AppSession): Promise<void> {
  const name = (await readdir(join(session.folder("x"), ".."))).find((entry) =>
    entry.startsWith("a-project-folder-whose-name"),
  );
  assert.ok(name !== undefined, "the scenario made no long folder");
  await session.page.getByTestId("title-sidebar").click();
  await waitUntil(async () => !(await sidebarShown(session)), waitMs, "the sidebar stayed");
  await session.answerFolderDialog(session.folder(name));
  await session.page.keyboard.press(`${commandModifier}+O`);
  await visible(session, `workspace-${name}-main`, "after adding with the sidebar hidden");
  await session.page.getByTestId(`workspace-${name}-main`).click();
  await session.page.setViewportSize({ width: 960, height: 600 });
  await placeReads(session, name, "on the long project");
  const layout = await session.page.evaluate(readStrip);
  assert.ok(
    layout.place.left >= layout.toggle.right && layout.place.right <= layout.inbox.left,
    `the long title ran from ${String(layout.place.left)} to ${String(layout.place.right)} over its neighbours`,
  );
  assert.ok(layout.clipped, "the long title was not cut with an ellipsis");
  assert.deepEqual(
    layout.hits,
    {
      "title-sidebar": true,
      "title-inbox": true,
      "title-commands": true,
      "title-new-workspace": true,
    },
    "a control in the strip was covered by the long title",
  );
  assert.deepEqual(layout.dragGaps, [true, true], "the long title left no drag area beside it");
  await session.screenshot("strip-long-project");
  await session.page.setViewportSize({ width: 1440, height: 900 });
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
  await session.screenshot("strip-hostile-project");
}

export const titleBarJourney: Journey = {
  name: "title-bar",
  scenario: "title-bar",
  async run(session) {
    await visible(session, "title-bar", "at launch");
    await checkStrip(session);
    await checkPlace(session);
    await checkInbox(session);
    await checkSidebar(session);
    await checkSizes(session);
    await checkLongName(session);
    await checkHostileProject(session);
    assert.deepEqual(session.consoleErrors, [], "the window logged console errors");
  },
};
