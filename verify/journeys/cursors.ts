import assert from "node:assert/strict";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { startClaude, visible, waitUntil } from "./conditions.ts";

interface Expected {
  name: string;
  selector: string;
  cursor: "pointer" | "default" | "text" | "col-resize";
}

const shownMs = 15_000;
const arrows = new Set(["auto", "default"]);
const smallTarget = 24;

function byTestId(testId: string): string {
  return `[data-testid="${testId}"]`;
}

async function cursorOf(session: AppSession, selector: string): Promise<string> {
  return session.page.evaluate((target) => {
    const element = document.querySelector(target);
    return element === null ? "missing" : getComputedStyle(element).cursor;
  }, selector);
}

async function cursorsAre(
  session: AppSession,
  expected: readonly Expected[],
  when: string,
): Promise<void> {
  const wrong: string[] = [];
  for (const { name, selector, cursor } of expected) {
    const read = await cursorOf(session, selector);
    const right = cursor === "default" ? arrows.has(read) : read === cursor;
    if (!right) wrong.push(`${name} read ${read} instead of ${cursor}`);
  }
  assert.deepEqual(wrong, [], `${when}, ${wrong.join(", ")}`);
}

async function targetFits(session: AppSession, testId: string, name: string): Promise<void> {
  const box = await session.page.getByTestId(testId).boundingBox();
  assert.ok(
    box !== null && box.width >= smallTarget && box.height >= smallTarget,
    `${name} measured ${box === null ? "nothing" : `${String(box.width)} by ${String(box.height)}`}, under ${String(smallTarget)} by ${String(smallTarget)}`,
  );
}

async function hoverFills(session: AppSession, selector: string, name: string): Promise<void> {
  const target = session.page.locator(selector).first();
  const background = () => target.evaluate((element) => getComputedStyle(element).backgroundColor);
  const resting = await background();
  await target.hover();
  let hovered = resting;
  await waitUntil(
    async () => {
      hovered = await background();
      return hovered !== resting;
    },
    shownMs,
    () => `${name} kept ${hovered} under the pointer`,
  );
}

async function run(session: AppSession): Promise<void> {
  const { page } = session;
  await page.getByTestId("workspace-repo-alpha").click();
  await page.getByTestId("centre-tab-pull-request").click();
  await waitUntil(
    async () => (await page.getByTestId("markdown-link").count()) > 0,
    shownMs,
    "the description drew no link",
  );
  await visible(session, "inbox-empty", "with nothing waiting");
  await cursorsAre(
    session,
    [
      {
        name: "the selected centre tab",
        selector: byTestId("centre-tab-pull-request"),
        cursor: "pointer",
      },
      { name: "a centre tab", selector: byTestId("centre-tab-changes"), cursor: "pointer" },
      {
        name: "a section tab",
        selector: byTestId("pull-request-section-checks"),
        cursor: "pointer",
      },
      {
        name: "the current sidebar row",
        selector: byTestId("workspace-repo-alpha"),
        cursor: "pointer",
      },
      { name: "a sidebar row", selector: byTestId("workspace-repo-main"), cursor: "pointer" },
      { name: "a link", selector: byTestId("markdown-link"), cursor: "pointer" },
      { name: "a button", selector: byTestId("pull-request-open"), cursor: "pointer" },
      { name: "the title bar strip", selector: byTestId("title-bar"), cursor: "default" },
      { name: "a title bar button", selector: byTestId("title-commands"), cursor: "pointer" },
      {
        name: "the title bar's unavailable inbox",
        selector: byTestId("title-inbox"),
        cursor: "default",
      },
      { name: "the left divider", selector: byTestId("divider-left"), cursor: "col-resize" },
      { name: "the right divider", selector: byTestId("divider-right"), cursor: "col-resize" },
      { name: "a description's text", selector: byTestId("pull-request-body"), cursor: "default" },
    ],
    "on the Pull request tab",
  );

  await page.getByTestId("centre-tab-changes").click();
  await waitUntil(
    async () => (await page.locator(".monaco-editor .view-lines").count()) > 0,
    shownMs,
    "the diff never drew",
  );
  await cursorsAre(
    session,
    [
      { name: "a file row", selector: '[data-testid="changes-file-0"]', cursor: "pointer" },
      { name: "a segmented option", selector: '[role="radio"]', cursor: "pointer" },
      { name: "the diff's lines", selector: ".monaco-editor .view-lines", cursor: "text" },
    ],
    "on the Changes tab",
  );
  await hoverFills(session, '[role="radio"][aria-checked="false"]', "a segmented option");

  await page.getByTestId("centre-tab-files").click();
  await visible(session, "files-row-0", "on the Files tab");
  await cursorsAre(
    session,
    [{ name: "a tree row", selector: byTestId("files-row-0"), cursor: "pointer" }],
    "on the Files tab",
  );
  await page.locator(`[data-testid^="files-row-"][data-path="src"]`).click();
  await page.locator('[data-testid^="files-row-"][data-path="src/app.ts"]').click();
  await visible(session, "file-tab-0", "after opening a file");
  await targetFits(session, "file-tab-0-close", "a file tab's close button");

  await startClaude(session, 1);
  await cursorsAre(
    session,
    [
      { name: "a session tab", selector: byTestId("session-tab-1"), cursor: "pointer" },
      { name: "the terminal", selector: `${byTestId("terminal")} .xterm-screen`, cursor: "text" },
    ],
    "with Claude Code running",
  );
  await targetFits(session, "close-session-1", "a session tab's close button");

  await page.getByTestId("title-new-workspace").click();
  await visible(session, "workspace-name", "in the New workspace dialog");
  await cursorsAre(
    session,
    [
      { name: "a text field", selector: byTestId("workspace-name"), cursor: "text" },
      { name: "a select", selector: byTestId("workspace-start"), cursor: "pointer" },
      { name: "the dialog's title", selector: '[role="dialog"] h2', cursor: "default" },
    ],
    "in the New workspace dialog",
  );
  await page.keyboard.press("Escape");
  assert.deepEqual(session.consoleErrors, [], "the window logged console errors");
}

export const cursorsJourney: Journey = { name: "cursors", scenario: "pr-open", run };
