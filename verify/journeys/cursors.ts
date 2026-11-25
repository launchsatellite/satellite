import assert from "node:assert/strict";
import type { AppSession } from "../driver.ts";
import { startClaude, visible, waitUntil } from "./conditions.ts";

interface Expected {
  name: string;
  selector: string;
  cursor: "pointer" | "default" | "text" | "col-resize";
}

const shownMs = 15_000;
const arrows = new Set(["auto", "default"]);
const smallTarget = 24;
const closeContrast = 1.2;

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

async function closeStandsOut(session: AppSession, testId: string, name: string): Promise<void> {
  const close = session.page.getByTestId(testId);
  await close.hover();
  let read = { square: "", tab: "", ratio: 0 };
  await waitUntil(
    async () => {
      read = await close.evaluate((button) => {
        const square = getComputedStyle(button.firstElementChild ?? button).backgroundColor;
        const tab = getComputedStyle(button.parentElement ?? button).backgroundColor;
        const paint = document.createElement("canvas").getContext("2d", {
          willReadFrequently: true,
        });
        if (paint === null) return { square, tab, ratio: 0 };
        const shown = (layers: string[]) => {
          paint.clearRect(0, 0, 1, 1);
          for (const layer of ["#ffffff", ...layers]) {
            paint.fillStyle = layer;
            paint.fillRect(0, 0, 1, 1);
          }
          const [r = 0, g = 0, b = 0] = paint.getImageData(0, 0, 1, 1).data;
          const linear = (channel: number) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
        };
        const [light, dark] = [shown([tab, square]), shown([tab])].sort((x, y) => y - x);
        return { square, tab, ratio: ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05) };
      });
      return read.ratio >= closeContrast;
    },
    shownMs,
    () =>
      `${name} drew ${read.square} on its tab's ${read.tab} under the pointer, ${read.ratio.toFixed(2)} to 1`,
  );
}

export async function threadMarkPoints(session: AppSession): Promise<void> {
  let read = "";
  await waitUntil(
    async () => {
      read = await session.page.evaluate(() => {
        const mark = document.querySelector(".thread-mark");
        if (mark === null) return "missing";
        const box = mark.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === null ? "nothing" : getComputedStyle(hit).cursor;
      });
      return read === "pointer";
    },
    shownMs,
    () => `the thread mark read ${read} under the pointer`,
  );
}

async function openFile(session: AppSession, path: string): Promise<void> {
  await session.page.locator(`[data-testid^="files-row-"][data-path="${path}"]`).click();
}

export async function pointerAndTargets(session: AppSession): Promise<void> {
  const { page } = session;
  await waitUntil(
    async () => (await page.getByTestId("markdown-link").count()) > 0,
    shownMs,
    "the description drew no link",
  );
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
      { name: "a file row", selector: byTestId("changes-file-0"), cursor: "pointer" },
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
  await openFile(session, "src");
  await openFile(session, "src/app.ts");
  await visible(session, "file-tab-0", "after opening a file");
  await openFile(session, "README.md");
  await visible(session, "file-tab-1", "after opening a second file");
  await targetFits(session, "file-tab-0-close", "a file tab's close button");
  await closeStandsOut(session, "file-tab-1-close", "the selected file tab's close square");
  await closeStandsOut(session, "file-tab-0-close", "a hovered file tab's close square");

  await startClaude(session, 1);
  await page.getByTestId("new-session").click();
  await visible(session, "session-tab-2", "after a second session");
  await cursorsAre(
    session,
    [
      { name: "a session tab", selector: byTestId("session-tab-1"), cursor: "pointer" },
      { name: "the terminal", selector: `${byTestId("terminal")} .xterm-screen`, cursor: "text" },
    ],
    "with Claude Code running",
  );
  await targetFits(session, "close-session-1", "a session tab's close button");
  await closeStandsOut(session, "close-session-2", "the selected session tab's close square");
  await closeStandsOut(session, "close-session-1", "a hovered session tab's close square");

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
}
