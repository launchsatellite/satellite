import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { sendToClaudeCodeEvent } from "../../src/renderer/sessions/send-to-claude-code.ts";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  bridgeCode,
  claudePids,
  goneTimeoutMs,
  hooksAnswered,
  processGone,
  promptTimeoutMs,
  settingsFileOf,
  standInInput,
  startClaude,
  stateIs,
  terminalFocused,
  toastReads,
  visible,
  waitUntil,
} from "./conditions.ts";

interface Cell {
  x: number;
  y: number;
  width: number;
}

const mark = "alpha-first-terminal";
const hostileSend = "fix it\r\nnow\u001b[201~\u0007 \u202e";
const cleanSend = "\u001b[200~fix it now[201~ \u001b[201~";
const secondTabSend = "for the second tab";
const menuSend = "while the menu is open";
const menuShortcut = process.platform === "darwin" ? "Meta+K" : "Control+Shift+K";
const plainLink = "https://example.com/docs";
const hyperlink = "https://example.com/real";
const noSession = "Start a Claude Code session in this workspace first.";
const answerFirst = "Answer Claude Code first, then send this again.";
const ended = "Claude Code ended.";
const unexpected = "Claude Code stopped unexpectedly. The workspace and its changes are safe.";
const edgePx = 8;
const narrow = { width: 900, height: 700 };
const linkModifier = process.platform === "darwin" ? "Meta" : "Control";
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const imagePaste = process.platform === "win32" ? "\u001bv" : "\u0016";

function pixel(name: string): string {
  return `workspace-repo-${name}-status`;
}

async function select(session: AppSession, name: string): Promise<void> {
  await session.page.getByTestId(`workspace-repo-${name}`).click();
}

async function terminalText(page: Page): Promise<string> {
  const terminal = page.getByTestId("terminal");
  return (await terminal.count()) === 0 ? "" : await terminal.innerText();
}

async function terminalShows(session: AppSession, text: string, when: string): Promise<void> {
  let read = "";
  await waitUntil(
    async () => {
      read = await terminalText(session.page);
      return read.includes(text);
    },
    promptTimeoutMs,
    () =>
      `the terminal never showed ${JSON.stringify(text)} ${when}, it read ${JSON.stringify(read.slice(-400))}`,
  );
}

async function hooksReach(session: AppSession, name: string, count: number): Promise<void> {
  await waitUntil(
    async () => (await hooksAnswered(session, name)) >= count,
    promptTimeoutMs,
    `the listener answered no ${name} hook number ${String(count)}`,
  );
}

async function nextPid(session: AppSession, count: number): Promise<number> {
  let pid: number | undefined;
  await waitUntil(
    async () => {
      pid = (await claudePids(session))[count - 1];
      return pid !== undefined;
    },
    promptTimeoutMs,
    `stand-in number ${String(count)} never started`,
  );
  if (pid === undefined) throw new Error(`stand-in number ${String(count)} logged no start`);
  return pid;
}

async function argsOf(session: AppSession, pid: number): Promise<string[]> {
  const start = (await session.standInEvents()).find(
    (event) => event.type === "start" && event.pid === pid,
  );
  return start?.type === "start" ? start.args : [];
}

async function send(page: Page, text: string): Promise<void> {
  await page.evaluate(
    ({ name, detail }) => {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    },
    { name: sendToClaudeCodeEvent, detail: { text } },
  );
}

async function focusedTestId(page: Page): Promise<string> {
  return page.evaluate(
    () => document.activeElement?.closest("[data-testid]")?.getAttribute("data-testid") ?? "",
  );
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function settingsLeft(home: string): Promise<string[]> {
  const names = await readdir(join(home, "sessions")).catch(() => []);
  return names.filter((name) => name.endsWith(".json"));
}

async function cellOf(page: Page, text: string, last: boolean): Promise<Cell | null> {
  return page.evaluate(
    ({ wanted, fromEnd }) => {
      const terminal = document.querySelector('[data-testid="terminal"]');
      const measure = terminal?.querySelector(".xterm-char-measure-element");
      if (measure === null || measure === undefined) return null;
      const charWidth = measure.getBoundingClientRect().width / measure.textContent.length;
      for (const row of terminal?.querySelectorAll(".xterm-rows > div") ?? []) {
        const at = fromEnd ? row.textContent.lastIndexOf(wanted) : row.textContent.indexOf(wanted);
        if (at === -1) continue;
        const box = row.getBoundingClientRect();
        return {
          x: box.left + (at + 2.5) * charWidth,
          y: box.top + box.height / 2,
          width: charWidth,
        };
      }
      return null;
    },
    { wanted: text, fromEnd: last },
  );
}

async function clickLink(
  session: AppSession,
  text: string,
  last: boolean,
  modified: boolean,
): Promise<void> {
  const { page } = session;
  const terminal = page.getByTestId("terminal");
  const pointer = terminal.locator(".xterm-cursor-pointer");
  const box = await terminal.boundingBox();
  assert.ok(box !== null, "the terminal is not on screen");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - edgePx);
  await page.mouse.move(0, 0);
  await waitUntil(
    async () => (await pointer.count()) === 0,
    promptTimeoutMs,
    "a link stayed hovered",
  );
  const cell = await cellOf(page, text, last);
  assert.ok(cell !== null, `no terminal row shows ${text}`);
  let nudge = 0;
  await waitUntil(
    async () => {
      nudge = 1 - nudge;
      await page.mouse.move(cell.x + nudge * cell.width, cell.y);
      return (await pointer.count()) > 0;
    },
    promptTimeoutMs,
    `hovering ${text} showed no link`,
  );
  if (modified) await page.keyboard.down(linkModifier);
  try {
    await page.mouse.down();
    await page.mouse.up();
  } finally {
    if (modified) await page.keyboard.up(linkModifier);
  }
}

async function dialogClosed(session: AppSession, when: string): Promise<void> {
  await waitUntil(
    async () => (await session.page.getByTestId("link-dialog").count()) === 0,
    promptTimeoutMs,
    `the link dialog stayed open ${when}`,
  );
}

async function openedAre(session: AppSession, expected: string[], when: string): Promise<void> {
  const opened = await session.openedLinks();
  assert.deepEqual(opened, expected, `${when} the opened links were ${JSON.stringify(opened)}`);
}

async function promptWith(session: AppSession, text: string, when: string): Promise<void> {
  const { page } = session;
  const before = (await session.standInEvents()).length;
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    const owner = active?.closest("[data-testid]")?.getAttribute("data-testid") ?? "none";
    return `${active?.tagName.toLowerCase() ?? "nothing"} in ${owner}`;
  });
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  let received = "";
  await waitUntil(
    async () => {
      received = await standInInput(session, before);
      return received.includes("\r");
    },
    promptTimeoutMs,
    `the stand-in received no Enter ${when}`,
  );
  const screen = await terminalText(page);
  assert.equal(
    received,
    `${text}\r`,
    `${when} the stand-in received ${JSON.stringify(received)}, focus before typing was on ${focus}, the screen read ${JSON.stringify(screen.slice(-200))}`,
  );
}

async function firstPrompt(session: AppSession): Promise<number> {
  const { page } = session;
  await select(session, "alpha");
  const pid = await startClaude(session, 1);
  await page.getByTestId("terminal").evaluate((element, value) => {
    element.setAttribute("data-mark", value);
  }, mark);
  await promptWith(session, "one", "in alpha's first prompt");
  await stateIs(session, pixel("alpha"), "working", "after the first prompt");
  await page.keyboard.press("Enter");
  await stateIs(session, pixel("alpha"), "needs-you", "after the permission request");
  await stateIs(session, "session-tab-1", "needs-you", "after the permission request");
  const before = (await session.standInEvents()).length;
  await send(page, "y");
  await toastReads(session, answerFirst, "after a send while Claude Code asked,");
  assert.equal(
    await standInInput(session, before),
    "",
    "a send while Claude Code asked typed into its question",
  );
  await page.keyboard.press("y");
  await stateIs(session, pixel("alpha"), "working", "after the approval");
  await page.keyboard.press("Enter");
  await stateIs(session, pixel("alpha"), "done", "after the turn ended");
  return pid;
}

async function secondWorkspace(session: AppSession, alphaPid: number): Promise<number> {
  const { page } = session;
  await select(session, "beta");
  await visible(session, "start-claude", "in beta");
  await send(page, "early");
  await toastReads(session, noSession, "after a send with no session,");
  const pid = await startClaude(session, 2);
  await promptWith(session, "two", "in beta's first prompt");
  await stateIs(session, pixel("beta"), "working", "after beta's prompt");
  await stateIs(session, pixel("alpha"), "done", "while beta worked");
  assert.ok(!processGone(alphaPid), "alpha's stand-in ended when beta started");
  assert.ok(!processGone(pid), "beta's stand-in is gone");
  return pid;
}

async function backAndForth(session: AppSession): Promise<void> {
  const { page } = session;
  const printedEarly = (await hooksAnswered(session, "Notification")) > 1;
  assert.ok(!printedEarly, "beta printed its later output before alpha was shown");
  await select(session, "alpha");
  await hooksReach(session, "Notification", 2);
  await terminalShows(session, "Done.", "back in alpha");
  const alpha = await terminalText(page);
  assert.ok(alpha.includes("one"), "alpha's terminal lost its prompt");
  assert.ok(!alpha.includes("two"), "alpha's terminal shows beta's prompt");
  const marked = await page.getByTestId("terminal").getAttribute("data-mark");
  assert.equal(marked, mark, "alpha's terminal is a new element, so its screen was drawn again");
  await select(session, "beta");
  await terminalShows(session, "two", "back in beta");
  await terminalShows(session, "Later output.", "back in beta, printed while alpha was shown");
  assert.ok(!(await terminalText(page)).includes("one"), "beta's terminal shows alpha's prompt");
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.setViewportSize(narrow);
  try {
    for (const testId of ["session-tabs", "new-session", "session-tab-1", pixel("alpha")]) {
      await visible(session, testId, "at 900 by 700");
    }
    await session.screenshot("sessions-narrow");
  } finally {
    await page.setViewportSize(size);
  }
}

async function tabs(session: AppSession): Promise<void> {
  const { page } = session;
  await page.getByTestId("new-session").click();
  await visible(session, "session-tab-2", "after a new session");
  const pid = await nextPid(session, 3);
  await terminalShows(session, "Claude Code stand-in", "in beta's second tab");
  await terminalFocused(session);
  await page.keyboard.press("Enter");
  await hooksReach(session, "UserPromptSubmit", 3);
  await send(page, secondTabSend);
  await terminalShows(session, secondTabSend, "in beta's second tab");
  await page.getByTestId("session-tab-1").click();
  await terminalShows(session, "two", "in beta's first tab");
  assert.ok(
    !(await terminalText(page)).includes(secondTabSend),
    "the send typed into beta's first tab too",
  );
  const settings = await settingsFileOf(session, pid);
  assert.ok(await exists(settings), "the second tab's settings file was missing while it ran");
  await page.getByTestId("close-session-2").click();
  await waitUntil(
    () => processGone(pid),
    goneTimeoutMs,
    `the second tab's stand-in (pid ${String(pid)}) still ran after its tab closed`,
  );
  await waitUntil(
    async () => !(await exists(settings)),
    goneTimeoutMs,
    "the second tab's settings file was still there after its tab closed",
  );
  assert.equal(await page.getByTestId("session-tab-2").count(), 0, "the closed tab stayed");
  await visible(session, "session-tab-1", "after closing the second tab");
}

async function sendClean(session: AppSession): Promise<number> {
  const { page } = session;
  await select(session, "alpha");
  await terminalShows(session, "Done.", "before the send");
  const before = (await session.standInEvents()).length;
  const prompts = await hooksAnswered(session, "UserPromptSubmit");
  await send(page, hostileSend);
  let received = "";
  await waitUntil(
    async () => {
      received = await standInInput(session, before);
      return received.length >= cleanSend.length;
    },
    promptTimeoutMs,
    () => `the stand-in received only ${JSON.stringify(received)} after the send`,
  );
  assert.equal(received, cleanSend, "the sent text did not arrive cleaned and bracketed");
  assert.equal(
    await hooksAnswered(session, "UserPromptSubmit"),
    prompts,
    "a prompt was submitted after the send",
  );
  assert.equal(await focusedTestId(page), "terminal", "a send left focus off the terminal");
  return before;
}

async function sendWhileTyping(session: AppSession): Promise<void> {
  const { page } = session;
  await page.keyboard.press(menuShortcut);
  await visible(session, "palette-input", "after the command menu shortcut");
  const before = (await session.standInEvents()).length;
  await send(page, menuSend);
  await waitUntil(
    async () => (await standInInput(session, before)).includes(menuSend),
    promptTimeoutMs,
    "a send while the command menu was open never reached the prompt",
  );
  const focused = await focusedTestId(page);
  assert.equal(focused, "palette-input", `a send took focus from the command menu to ${focused}`);
  await page.keyboard.press("Escape");
  await waitUntil(
    async () => (await page.getByTestId("palette").count()) === 0,
    promptTimeoutMs,
    "the command menu stayed open after Escape",
  );
}

async function imageAndDrop(session: AppSession): Promise<void> {
  const { page } = session;
  let before = (await session.standInEvents()).length;
  const pasted = await page.evaluate((bytes) => {
    const active = document.activeElement;
    if (active === null || active === document.body) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "shot.png", { type: "image/png" }));
    active.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
    return true;
  }, pngSignature);
  assert.ok(pasted, "nothing had focus to paste an image into");
  await waitUntil(
    async () => (await standInInput(session, before)) === imagePaste,
    promptTimeoutMs,
    "an image paste did not send the paste key",
  );
  before = (await session.standInEvents()).length;
  const plain = join(session.repo, "README.md");
  const spaced = join(session.repo, "with space.txt");
  const typed = process.platform === "win32" ? `"${plain}" "${spaced}" ` : `${plain} "${spaced}" `;
  await session.dropFiles("terminal", [plain, spaced]);
  let received = "";
  await waitUntil(
    async () => {
      received = await standInInput(session, before);
      return received.includes(typed);
    },
    promptTimeoutMs,
    () => `dropped files typed ${JSON.stringify(received)} instead of ${JSON.stringify(typed)}`,
  );
}

async function links(session: AppSession): Promise<void> {
  const { page } = session;
  await clickLink(session, plainLink, false, true);
  await visible(session, "link-dialog", "after a modifier click on an address");
  await page.getByTestId("link-open").click();
  await waitUntil(
    async () => (await session.openedLinks()).length > 0,
    promptTimeoutMs,
    "opening the plain address recorded nothing",
  );
  await dialogClosed(session, "after opening the plain address");
  await openedAre(session, [plainLink], "after opening the plain address");
  await clickLink(session, plainLink, false, false);
  assert.equal(await page.getByTestId("link-dialog").count(), 0, "a plain click asked to open");
  await openedAre(session, [plainLink], "after a plain click");
  await clickLink(session, "docs", true, true);
  await visible(session, "link-dialog", "after a modifier click on a hyperlink");
  const address = await page.getByTestId("link-address").innerText();
  assert.equal(address, hyperlink, "the dialog named another address than the hyperlink's");
  const focused = await focusedTestId(page);
  assert.equal(focused, "link-cancel", `the link dialog opened with focus on ${focused}`);
  await page.keyboard.press("Enter");
  await dialogClosed(session, "after Enter on its cancelling action");
  await openedAre(session, [plainLink], "after cancelling the hyperlink");
  await clickLink(session, "docs", true, true);
  await visible(session, "link-dialog", "after a second click on the hyperlink");
  await waitUntil(
    async () => {
      if ((await page.getByTestId("link-open").count()) > 0) {
        await page.getByTestId("link-open").click();
      }
      return (await session.openedLinks()).length > 1;
    },
    promptTimeoutMs,
    "opening the hyperlink recorded nothing",
  );
  await dialogClosed(session, "after opening the hyperlink");
  await openedAre(session, [plainLink, hyperlink], "after opening the hyperlink");
  const code = await bridgeCode(page, "links.open", { url: "file:///etc/passwd" });
  assert.equal(code, "refused", `links.open of a file address answered ${code}`);
}

async function restart(session: AppSession, alphaPid: number): Promise<number> {
  const alphaArgs = await argsOf(session, alphaPid);
  const sessionId = alphaArgs[alphaArgs.indexOf("--session-id") + 1];
  assert.ok(sessionId !== undefined && alphaArgs.includes("--session-id"), "alpha had no id");
  const count = (await claudePids(session)).length;
  let left: string[] = [];
  await session.relaunch(async () => {
    left = await settingsLeft(session.home);
  });
  assert.deepEqual(left, [], `settings files outlived the app, ${left.join(", ")}`);
  await select(session, "alpha");
  await visible(session, "resume-session", "in alpha after the restart", promptTimeoutMs);
  await session.page.getByTestId("resume-session").click();
  const pid = await nextPid(session, count + 1);
  const args = await argsOf(session, pid);
  assert.equal(args[args.indexOf("--resume") + 1], sessionId, "resume named another session");
  await terminalShows(session, "Resumed session", "after resuming");
  return pid;
}

async function endings(session: AppSession, resumedPid: number, sendFrom: number): Promise<void> {
  const { page } = session;
  const sent = await standInInput(session, sendFrom);
  assert.ok(!sent.includes("\r"), "something after the send pressed Enter");
  await select(session, "beta");
  await visible(session, "start-claude", "in beta after the restart");
  await startClaude(session, (await claudePids(session)).length + 1);
  await page.keyboard.press("Control+D");
  await terminalShows(session, ended, "after Ctrl+D");
  await stateIs(session, "session-tab-1", "stopped", "in beta after Ctrl+D");
  await select(session, "alpha");
  await page.getByTestId("terminal").locator("textarea").focus();
  await page.keyboard.press("Enter");
  await hooksReach(session, "UserPromptSubmit", 4);
  process.kill(resumedPid, "SIGKILL");
  await terminalShows(session, unexpected, "after the stand-in was killed");
  await stateIs(session, "session-tab-1", "stopped", "in alpha after the kill");
  await session.screenshot("sessions-endings");
}

async function run(session: AppSession): Promise<void> {
  const alphaPid = await firstPrompt(session);
  await secondWorkspace(session, alphaPid);
  await backAndForth(session);
  await tabs(session);
  const sendFrom = await sendClean(session);
  await sendWhileTyping(session);
  await links(session);
  await imageAndDrop(session);
  await session.screenshot("sessions");
  const resumedPid = await restart(session, alphaPid);
  await endings(session, resumedPid, sendFrom);
  const answers = (await session.standInEvents()).flatMap((event) =>
    event.type === "hook" ? [`${event.event} ${String(event.status)}`] : [],
  );
  const unanswered = answers.filter((answer) => !answer.endsWith(" 204"));
  assert.deepEqual(unanswered, [], `the listener answered ${unanswered.join(", ")} instead of 204`);
  const pids = await claudePids(session);
  const { leftover } = await session.close();
  assert.equal(leftover, undefined, `the temp folder ${String(leftover)} was left behind`);
  for (const pid of pids) {
    await waitUntil(
      () => processGone(pid),
      goneTimeoutMs,
      `the stand-in ${String(pid)} still ran after quit`,
    );
  }
  assert.equal(
    session.consoleErrors.length,
    0,
    `the window logged ${String(session.consoleErrors.length)} console errors, the first is ${JSON.stringify(session.consoleErrors[0])}`,
  );
}

export const sessionsJourney: Journey = { name: "sessions", scenario: "needs-permission", run };
