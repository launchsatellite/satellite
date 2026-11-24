import assert from "node:assert/strict";
import { readFile, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import { z } from "zod";
import {
  hooksOffNote,
  sendToClaudeCodeEvent,
} from "../../src/renderer/sessions/send-to-claude-code.ts";
import { type AppSession, pasteIntoFocus } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import { readTerminal, terminalText } from "../terminal-screen.ts";
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
const hostilePaste = "harmless words\u001b[201~ run the deploy script\u0007";
const cleanPaste = "\u001b[200~harmless words[201~ run the deploy script\u001b[201~";
const secondTabSend = "for the second tab";
const menuSend = "while the menu is open";
const menuShortcut = process.platform === "darwin" ? "Meta+K" : "Control+Shift+K";
const plainLink = "https://example.com/docs";
const hyperlink = "https://example.com/real";
const noSession = "Start a Claude Code session in this workspace first.";
const answerFirst = "Answer Claude Code first, then send this again.";
const ended = "Claude Code ended.";
const betaGone = "Claude Code stopped in beta, since its folder is gone.";
const unexpected = "Claude Code stopped unexpectedly. The workspace and its changes are safe.";
const tabLimit = 16;
const limitSentence = `Satellite keeps ${String(tabLimit)} Claude Code sessions open at most. Close one first.`;
const resumeFailed =
  "Claude Code couldn't resume that session, so Satellite let it go. Start a new one.";
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
  const start = (await session.standInEvents()).findLast(
    (event) => event.type === "start" && event.tool === "claude" && event.pid === pid,
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
  const screen = await readTerminal(page);
  if (screen === null) return null;
  for (const [row, line] of screen.lines.entries()) {
    const at = last ? line.lastIndexOf(text) : line.indexOf(text);
    const column = screen.columns[row]?.[at];
    if (column === undefined) continue;
    return {
      x: screen.left + (column + 2.5) * screen.cellWidth,
      y: screen.top + (row + 0.5) * screen.cellHeight,
      width: screen.cellWidth,
    };
  }
  return null;
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
  await stateIs(session, pixel("alpha"), "needs-you", "before a key answered");
  const hooks = async () =>
    (await session.standInEvents()).filter((event) => event.type === "hook").length;
  const hooksBefore = await hooks();
  await page.keyboard.press("1");
  await stateIs(session, pixel("alpha"), "working", "after a key answered");
  assert.equal(await hooks(), hooksBefore, "a hook arrived before the answering key turned alpha");
  await page.keyboard.press("y");
  await waitUntil(
    async () => (await hooksAnswered(session, "PostToolUse")) > 0,
    promptTimeoutMs,
    "no PostToolUse hook arrived after the approval",
  );
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

async function focusCommands(session: AppSession): Promise<void> {
  const { page } = session;
  const moves: [string, string][] = [
    ["Focus the sidebar", "workspace-repo-alpha"],
    ["Focus the repository", "centre-tab-changes"],
    ["Focus the terminal", "terminal"],
  ];
  for (const [title, target] of moves) {
    await page.keyboard.press(menuShortcut);
    await visible(session, "palette-input", `before ${title}`);
    await page.getByTestId("palette-input").fill(title);
    await page.keyboard.press("Enter");
    let focused = "";
    await waitUntil(
      async () => {
        focused = await focusedTestId(page);
        return focused === target;
      },
      promptTimeoutMs,
      () => `${title} moved focus to ${focused}`,
    );
  }
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
  await pasteIntoFocus(page, hostilePaste);
  let pastedText = "";
  await waitUntil(
    async () => {
      pastedText = await standInInput(session, before);
      return pastedText.length >= cleanPaste.length;
    },
    promptTimeoutMs,
    () => `a text paste typed only ${JSON.stringify(pastedText)}`,
  );
  assert.equal(pastedText, cleanPaste, "a pasted end of paste sequence reached Claude Code");
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

async function resumes(session: AppSession, sessionId: string): Promise<number[]> {
  return (await session.standInEvents()).flatMap((event) =>
    event.type === "start" &&
    event.tool === "claude" &&
    event.args[event.args.indexOf("--resume") + 1] === sessionId
      ? [event.pid]
      : [],
  );
}

async function noticesShown(session: AppSession): Promise<number> {
  return (await session.notices()).filter((line) => line.kind === "notice").length;
}

async function restart(
  session: AppSession,
  alphaPid: number,
): Promise<{ pid: number; shown: number }> {
  const alphaArgs = await argsOf(session, alphaPid);
  const sessionId = alphaArgs[alphaArgs.indexOf("--session-id") + 1];
  assert.ok(sessionId !== undefined && alphaArgs.includes("--session-id"), "alpha had no id");
  await select(session, "alpha");
  const count = (await claudePids(session)).length;
  const shown = await noticesShown(session);
  let left: string[] = [];
  await session.relaunch(async () => {
    left = await settingsLeft(session.home);
  });
  assert.deepEqual(left, [], `settings files outlived the app, ${left.join(", ")}`);
  const pid = await nextPid(session, count + 1);
  const args = await argsOf(session, pid);
  assert.equal(args[args.indexOf("--resume") + 1], sessionId, "resume named another session");
  await terminalShows(session, "Resumed session", "after resuming by itself");
  await stateIs(session, pixel("alpha"), "idle", "after resuming by itself");
  return { pid, shown };
}

async function switchesQuickly(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const settle = async () => {
      for (let turn = 0; turn < 50; turn += 1) {
        await new Promise<void>((done) => {
          queueMicrotask(done);
        });
      }
    };
    const row = (name: string) =>
      document.querySelector<HTMLElement>(`[data-testid="workspace-repo-${name}"]`);
    const inPane = (testId: string) =>
      document.querySelector(`[data-testid="column-sessions"] [data-testid="${testId}"]`) !== null;
    const shown = (name: string) => {
      const current = row(name)?.getAttribute("aria-current") === "true";
      if (inPane("session-tabs")) return `${name} ${String(current)} with tabs`;
      return `${name} ${String(current)} ${inPane("sessions-empty") ? "answered" : "asking"}`;
    };
    const seen: string[] = [];
    row("beta")?.click();
    await settle();
    seen.push(shown("beta"));
    row("alpha")?.click();
    await settle();
    seen.push(shown("alpha"));
    row("beta")?.click();
    await settle();
    seen.push(shown("beta"));
    row("beta")?.focus();
    return seen;
  });
}

async function startsAtOnce(
  page: Page,
  workspace: { projectId: string; workspace: string },
): Promise<{ ids: string[]; answers: string[] }> {
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const answers = await page.evaluate(
    async ({ ids: pair, ref }) => {
      const api: unknown = Reflect.get(window, "satellite");
      const invoke: unknown =
        typeof api === "object" && api !== null ? Reflect.get(api, "invoke") : undefined;
      if (typeof invoke !== "function") return ["window.satellite.invoke is missing"];
      const results: unknown[] = await Promise.all(
        pair.map((id): unknown =>
          Reflect.apply(invoke, api, [
            "terminal.start",
            { id, program: "claude", workspace: ref, resume: true, cols: 80, rows: 24 },
          ]),
        ),
      );
      return results.map((result) => {
        if (typeof result !== "object" || result === null) return "no answer";
        if (Reflect.get(result, "ok") === true) return "started";
        const error: unknown = Reflect.get(result, "error");
        return typeof error === "object" && error !== null
          ? String(Reflect.get(error, "code"))
          : "no code";
      });
    },
    { ids, ref: workspace },
  );
  return { ids, answers };
}

async function resumesWhenShown(session: AppSession, shown: number): Promise<void> {
  const { page } = session;
  const beta = await betaRef(session.home);
  const betaRecord = await recordOf(session.home, beta.workspace);
  const before = (await claudePids(session)).length;
  const clickedAt = (await session.standInEvents()).length;
  assert.deepEqual(
    await switchesQuickly(page),
    ["beta true asking", "alpha true with tabs", "beta true asking"],
    "the fast switch did not show beta asking, then alpha, then beta asking again",
  );
  const pid = await nextPid(session, before + 1);
  await terminalShows(session, "Resumed session", "in beta after it resumed by itself");
  const events = await session.standInEvents();
  const starts = events.flatMap((event, index) =>
    event.type === "start" &&
    event.tool === "claude" &&
    event.args[event.args.indexOf("--resume") + 1] === betaRecord
      ? [index]
      : [],
  );
  assert.equal(starts.length, 1, "beta resumed more than once around the fast switch");
  assert.ok((starts[0] ?? -1) >= clickedAt, "beta resumed before it was shown");
  assert.equal(
    await focusedTestId(page),
    "workspace-repo-beta",
    "resuming by itself took focus from beta's row",
  );
  await stateIs(session, pixel("beta"), "idle", "after beta resumed by itself");
  await page.getByTestId("close-session-1").click();
  await waitUntil(
    () => processGone(pid),
    goneTimeoutMs,
    `beta's resumed stand-in (pid ${String(pid)}) still ran after its tab closed`,
  );
  await visible(session, "resume-session", "in beta after closing its resumed tab");
  await select(session, "alpha");
  await terminalShows(session, "Resumed session", "back in alpha");
  await select(session, "beta");
  await visible(session, "resume-session", "in beta after a visit to alpha");
  const forged = await startsAtOnce(page, beta);
  assert.deepEqual(
    [...forged.answers].sort(),
    ["refused", "started"],
    `two resumes of beta's conversation asked at once answered ${forged.answers.join(" and ")}`,
  );
  const forgedPid = await nextPid(session, before + 2);
  for (const id of forged.ids) await bridgeCode(page, "terminal.close", { id });
  await waitUntil(
    () => processGone(forgedPid),
    goneTimeoutMs,
    "the forged resume's stand-in still ran after it closed",
  );
  assert.deepEqual(
    await resumes(session, betaRecord),
    [pid, forgedPid],
    "beta resumed again after its resumed tab was closed, or two starts at once both ran",
  );
  assert.equal(await noticesShown(session), shown, "resuming by itself raised a notification");
}

async function endings(session: AppSession, resumedPid: number, sendFrom: number): Promise<void> {
  const { page } = session;
  const sent = await standInInput(session, sendFrom);
  assert.ok(!sent.includes("\r"), "something after the send pressed Enter");
  await visible(session, "start-claude", "in beta after the restart");
  await startClaude(session, (await claudePids(session)).length + 1);
  await page.keyboard.press("Control+D");
  await terminalShows(session, ended, "after Ctrl+D");
  await stateIs(session, "session-tab-2", "stopped", "in beta after Ctrl+D");
  await select(session, "alpha");
  await page.getByTestId("terminal").locator("textarea").focus();
  await page.keyboard.press("Enter");
  await hooksReach(session, "UserPromptSubmit", 4);
  process.kill(resumedPid, "SIGKILL");
  await terminalShows(session, unexpected, "after the stand-in was killed");
  await stateIs(session, "session-tab-1", "stopped", "in alpha after the kill");
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
    "start-claude",
    "a crash moved focus to Start Claude Code",
  );
  const before = (await claudePids(session)).length;
  await page.keyboard.press("Enter");
  await delay(1500);
  assert.equal(
    (await claudePids(session)).length,
    before,
    "Enter pressed after a crash started a new session",
  );
  await session.screenshot("sessions-endings");
}

const sessionsFile = z.object({
  last: z.array(z.object({ workspace: z.string(), sessionId: z.string() })),
});
const projectsFile = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      workspaces: z.array(z.object({ id: z.string(), path: z.string() })),
    }),
  ),
});

async function recordedWorkspaces(home: string): Promise<string[]> {
  const raw = await readFile(join(home, "sessions.json"), "utf8");
  return sessionsFile.parse(JSON.parse(raw)).last.map(({ workspace }) => workspace);
}

async function recordOf(home: string, workspace: string): Promise<string> {
  const raw = await readFile(join(home, "sessions.json"), "utf8");
  const entry = sessionsFile
    .parse(JSON.parse(raw))
    .last.find((kept) => kept.workspace === workspace);
  assert.ok(entry !== undefined, `sessions.json holds no record for ${workspace}`);
  return entry.sessionId;
}

async function failedResume(session: AppSession): Promise<void> {
  await select(session, "alpha");
  await startClaude(session, 1);
  await session.page.keyboard.press("Enter");
  await hooksReach(session, "UserPromptSubmit", 1);
  await waitUntil(
    async () => (await recordedWorkspaces(session.home).catch(() => [])).length === 1,
    promptTimeoutMs,
    "sessions.json never recorded alpha's conversation",
  );
  await session.relaunch();
  const pid = await nextPid(session, 2);
  assert.ok((await argsOf(session, pid)).includes("--resume"), "alpha did not resume by itself");
  await waitUntil(
    async () => (await session.page.getByTestId("terminal-notice").textContent()) === resumeFailed,
    promptTimeoutMs,
    "the failed resume never showed its sentence",
  );
  await session.page.getByTestId("close-session-1").click();
  await visible(session, "start-claude", "after closing the failed resume");
  await select(session, "main");
  await select(session, "alpha");
  await visible(session, "start-claude", "back in alpha after the failed resume");
  await session.screenshot("sessions-resume-failed");
  const fresh = await startClaude(session, 3);
  assert.ok((await argsOf(session, fresh)).includes("--session-id"), "the new start resumed");
  const resumed = (await session.standInEvents()).filter(
    (event) => event.type === "start" && event.tool === "claude" && event.args.includes("--resume"),
  );
  assert.equal(resumed.length, 1, "a failed resume started again before the next start");
}

async function closedStaysClosed(session: AppSession): Promise<void> {
  await select(session, "alpha");
  const pid = await startClaude(session, 1);
  await session.page.keyboard.press("Enter");
  await hooksReach(session, "UserPromptSubmit", 1);
  await waitUntil(
    async () => (await recordedWorkspaces(session.home).catch(() => [])).length === 1,
    promptTimeoutMs,
    "sessions.json never recorded alpha's conversation",
  );
  await session.page.getByTestId("close-session-1").click();
  await waitUntil(
    () => processGone(pid),
    goneTimeoutMs,
    `alpha's stand-in (pid ${String(pid)}) still ran after its tab closed`,
  );
  await visible(session, "resume-session", "after closing a fresh session");
  await visible(session, "start-claude", "after closing a fresh session");
  await delay(1500);
  await select(session, "main");
  await select(session, "alpha");
  await visible(session, "resume-session", "back in alpha after closing its fresh session");
  await delay(1500);
  assert.deepEqual(
    await claudePids(session),
    [pid],
    "closing a fresh session's tab started Claude Code again by itself",
  );
  await session.screenshot("sessions-closed-stays-closed");
}

async function resumesWithRoom(session: AppSession): Promise<void> {
  const { page } = session;
  await select(session, "beta");
  await startClaude(session, 1);
  await page.keyboard.press("Enter");
  await hooksReach(session, "UserPromptSubmit", 1);
  const betaRecord = await waitForRecord(session.home);
  await select(session, "main");
  await session.relaunch();
  await select(session, "alpha");
  await session.page.getByTestId("start-claude").click();
  for (let tab = 2; tab <= tabLimit; tab += 1) {
    await session.page.getByTestId("new-session").click();
  }
  await nextPid(session, tabLimit + 1);
  await select(session, "beta");
  await waitUntil(
    async () => (await session.page.getByTestId("sessions-empty").textContent()) === limitSentence,
    promptTimeoutMs,
    "beta never said the limit of open sessions stood in the way",
  );
  const movedAt = (await session.standInEvents()).length;
  await rename(
    join(session.home, "worktrees", "repo", "alpha"),
    join(session.home, "alpha-moved-away"),
  );
  await session.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const pid = await nextPid(session, tabLimit + 2);
  const events = await session.standInEvents();
  const index = events.findIndex(
    (event) => event.type === "start" && event.tool === "claude" && event.pid === pid,
  );
  assert.ok(index >= movedAt, "beta resumed before alpha's sessions made room");
  assert.equal(
    (await argsOf(session, pid))[1],
    betaRecord,
    "beta started something other than its own conversation once there was room",
  );
  assert.deepEqual(await resumes(session, betaRecord), [pid], "beta resumed more than once");
  await terminalShows(session, "Resumed session", "in beta once there was room");
}

async function waitForRecord(home: string): Promise<string> {
  let record: string | undefined;
  await waitUntil(
    async () => {
      record = await recordOf(home, await betaId(home)).catch(() => undefined);
      return record !== undefined;
    },
    promptTimeoutMs,
    "sessions.json never recorded beta's conversation",
  );
  if (record === undefined) throw new Error("beta has no record");
  return record;
}

async function betaRef(home: string): Promise<{ projectId: string; workspace: string }> {
  const file = projectsFile.parse(JSON.parse(await readFile(join(home, "projects.json"), "utf8")));
  for (const project of file.projects) {
    const beta = project.workspaces.find(({ path }) => path.endsWith("beta"));
    if (beta !== undefined) return { projectId: project.id, workspace: beta.id };
  }
  throw new Error("projects.json holds no beta workspace");
}

async function betaId(home: string): Promise<string> {
  return (await betaRef(home)).workspace;
}

async function workspaceLeaves(session: AppSession): Promise<void> {
  const { page } = session;
  await select(session, "beta");
  await page.getByTestId("new-session").click();
  const pid = await nextPid(session, (await claudePids(session)).length + 1);
  const beta = await betaId(session.home);
  assert.ok(
    (await recordedWorkspaces(session.home)).includes(beta),
    "sessions.json held no record for beta before it left",
  );
  const folder = join(session.home, "worktrees", "repo", "beta");
  await rename(folder, join(session.home, "beta-moved-away"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await toastReads(session, betaGone, "after beta's folder moved away,");
  await waitUntil(
    () => processGone(pid),
    goneTimeoutMs,
    `beta's stand-in (pid ${String(pid)}) still ran after its folder moved away`,
  );
  await waitUntil(
    async () => !(await recordedWorkspaces(session.home)).includes(beta),
    goneTimeoutMs,
    "sessions.json still held beta's record after beta left",
  );
}

async function run(session: AppSession): Promise<void> {
  const alphaPid = await firstPrompt(session);
  await secondWorkspace(session, alphaPid);
  await backAndForth(session);
  await tabs(session);
  const sendFrom = await sendClean(session);
  await sendWhileTyping(session);
  await focusCommands(session);
  await links(session);
  await imageAndDrop(session);
  await session.screenshot("sessions");
  const { pid: resumedPid, shown } = await restart(session, alphaPid);
  await resumesWhenShown(session, shown);
  await endings(session, resumedPid, sendFrom);
  if (process.platform !== "win32") await workspaceLeaves(session);
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

async function hookCount(session: AppSession): Promise<number> {
  return (await session.standInEvents()).filter((event) => event.type === "hook").length;
}

async function interrupts(session: AppSession): Promise<void> {
  const { page } = session;
  await select(session, "alpha");
  await startClaude(session, 1);
  await promptWith(session, "one", "in the first prompt");
  await stateIs(session, "session-tab-1", "working", "after the first prompt");
  await hooksReach(session, "UserPromptSubmit", 1);
  const before = await hookCount(session);
  await page.keyboard.press("Escape");
  await terminalShows(session, "Interrupted.", "after Escape stopped the turn");
  await stateIs(session, "session-tab-1", "idle", "once the turn stayed quiet after Escape");
  assert.equal(await hookCount(session), before, "a hook arrived after the interrupt");

  await promptWith(session, "two", "in the second prompt");
  await stateIs(session, "session-tab-1", "needs-you", "after the permission request");
  await hooksReach(session, "PermissionRequest", 1);
  const asked = await hookCount(session);
  await page.keyboard.press("Escape");
  await stateIs(session, "session-tab-1", "idle", "after Escape declined");
  assert.equal(await hookCount(session), asked, "a hook arrived before Escape turned the tab");
  await stateIs(session, pixel("alpha"), "idle", "after Escape declined, in the sidebar");

  await promptWith(session, "three", "in the third prompt");
  await stateIs(session, "session-tab-1", "working", "after the third prompt");
  await page.keyboard.press("Escape");
  await hooksReach(session, "PostToolUse", 1);
  await stateIs(session, "session-tab-1", "working", "while a tool finished after Escape");
  await stateIs(session, "session-tab-1", "idle", "once the turn stayed quiet after the tool");
  await promptWith(session, "four", "in the fourth prompt");
  await stateIs(session, "session-tab-1", "working", "after the fourth prompt");
  await terminalShows(session, "Working on four.", "in the fourth turn");
  await page.keyboard.press("Escape");
  const seen = new Set<string>();
  const until = Date.now() + 6000;
  while (Date.now() < until) {
    seen.add((await page.getByTestId("session-tab-1").getAttribute("data-state")) ?? "");
    await page.waitForTimeout(200);
  }
  assert.deepEqual(
    [...seen],
    ["working"],
    "an Escape that interrupted nothing, while Claude Code kept drawing, turned the tab",
  );
  await stateIs(session, "session-tab-1", "done", "after the turn that survived Escape ended");
  const { leftover } = await session.close();
  assert.equal(leftover, undefined, `the temp folder ${String(leftover)} was left behind`);
}

async function hooksOff(session: AppSession): Promise<void> {
  const { page } = session;
  await select(session, "alpha");
  await startClaude(session, 1);
  await promptWith(session, "one", "in a session without hooks");
  const tab = page.getByTestId("session-tab-1");
  await waitUntil(
    async () => (await tab.getAttribute("data-hooks-off")) !== null,
    promptTimeoutMs,
    "the tab never said hooks are off while Claude Code worked without one",
  );
  assert.equal(await tab.getAttribute("title"), hooksOffNote, "the tab's tooltip");
  await stateIs(session, "session-tab-1", "idle", "with hooks off");
  await terminalShows(session, "Done.", "after the work without hooks");
  await send(page, "later");
  await toastReads(
    session,
    `${hooksOffNote} Type this one yourself.`,
    "after a send with hooks off,",
  );
  assert.equal(await hookCount(session), 0, "a hook arrived in a session without hooks");
  await session.screenshot("sessions-hooks-off");
  const { leftover } = await session.close();
  assert.equal(leftover, undefined, `the temp folder ${String(leftover)} was left behind`);
}

export const sessionsJourney: Journey = {
  name: "sessions",
  scenario: "needs-permission",
  run,
  then: [
    { name: "sessions", scenario: "interrupts", run: interrupts },
    { name: "sessions", scenario: "hooks-off", run: hooksOff },
    { name: "sessions", scenario: "session-endings", run: failedResume },
    { name: "sessions", scenario: "needs-permission", run: closedStaysClosed },
    {
      name: "sessions",
      scenario: "needs-permission",
      run: resumesWithRoom,
      skip:
        process.platform === "win32"
          ? "Windows cannot move a folder a process runs in, which is how this part makes room"
          : undefined,
    },
  ],
};
