import assert from "node:assert/strict";
import { appendFile, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  promptTimeoutMs,
  standInInput,
  startClaude,
  stateIs,
  terminalFocused,
  toastReads,
  waitUntil,
} from "./conditions.ts";

interface Row {
  path: string;
  state: string;
  text: string;
  current: boolean;
}

const shortcut = process.platform === "darwin" ? "Meta+L" : "Control+Shift+L";
const bracketed = (text: string) => `\u001b[200~${text}\u001b[201~`;
const noLinesSentence = "Select some lines in the diff first.";
const hiddenNameSentence =
  "This file's name holds hidden characters, so Satellite can't point Claude Code at it. Ask in your own words.";
const notReadySentence =
  "Satellite sends here only after Claude Code reports your first request. Type this one yourself.";
const waitMs = 15_000;
const settleMs = 5000;
const quickMs = 2000;
const quietMs = 1500;
const backoffMs = 20_000;
const pollCapMs = 30_000;
const turnRefreshMs = 5000;
const branchRows: [string, string][] = [
  ["-dash.txt", "A"],
  ["README.md", "M"],
  ["caf\u{e9} notes.md", "R"],
  ["docs/new guide.md", "A"],
  ["it's new.txt", "A"],
  ["logo.bin", "A"],
  ["old.txt", "D"],
  ["report\u{202e}txt.md", "A"],
  ["src/app.ts", "M"],
];
const uncommittedRows = [
  "-dash.txt",
  "README.md",
  "it's new.txt",
  "logo.bin",
  "report\u{202e}txt.md",
];
const binarySentence = "This is a binary file, so there is no diff to show.";
const notUtf8Sentence = "This file isn't UTF-8 text, so there is no diff to show.";
const largeSentence = "This file is too large to show here, over 1 MB or 20,000 lines.";
const hostileApp =
  "export function greet(name: string) {\r\n" +
  '  const greeting = "Hello\u{200b}\u{17b4}";\n' +
  '  const p\u{430}ypal = "lone\rreturn";\n' +
  "  return `${greeting}, ${name}!`\u{37e}\n" +
  "}\n";

function worktree(session: AppSession): string {
  return join(session.home, "worktrees", "repo", "alpha");
}

async function rows(page: Page): Promise<Row[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="changes-list"] button')].map(
      (row) => ({
        path: row.dataset["path"] ?? "",
        state: row.dataset["state"] ?? "",
        text: row.innerText,
        current: row.getAttribute("aria-selected") === "true",
      }),
    ),
  );
}

async function nudge(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

async function rowOf(
  session: AppSession,
  path: string,
  when: string,
  ask = true,
  limitMs = waitMs,
): Promise<Row> {
  let found: Row | undefined;
  if (ask) await nudge(session.page);
  await waitUntil(
    async () => {
      found = (await rows(session.page)).find((row) => row.path === path);
      return found !== undefined;
    },
    limitMs,
    `no row for ${path} appeared ${when}`,
  );
  if (found === undefined) throw new Error(`no row for ${path} ${when}`);
  return found;
}

async function select(session: AppSession, path: string): Promise<void> {
  await rowOf(session, path, "to select it", false);
  await session.page
    .locator(`[data-testid="changes-list"] button[data-path=${JSON.stringify(path)}]`)
    .click();
  await waitUntil(
    async () => (await rowOf(session, path, "while selecting it")).current,
    waitMs,
    `${path} never became the selected row`,
  );
}

async function sideText(page: Page, side: "original" | "modified"): Promise<string> {
  const lines = page.locator(`[data-testid="diff"] .editor.${side} .lines-content > .view-lines`);
  if ((await lines.count()) === 0) return "";
  return (await lines.first().innerText()).replaceAll("\u{a0}", " ");
}

async function modifiedShows(session: AppSession, text: string, when: string): Promise<void> {
  let shown = "";
  await waitUntil(
    async () => {
      shown = await sideText(session.page, "modified");
      return shown.includes(text);
    },
    waitMs,
    () =>
      `the modified side did not show ${JSON.stringify(text)} ${when}, it read ${JSON.stringify(shown.slice(0, 200))}`,
  );
}

async function sentenceReads(session: AppSession, expected: string, when: string): Promise<void> {
  const sentence = session.page.getByTestId("changes-sentence");
  let shown = "";
  await waitUntil(
    async () => {
      shown = (await sentence.count()) === 0 ? "" : await sentence.innerText();
      return shown === expected;
    },
    waitMs,
    () => `changes-sentence read ${JSON.stringify(shown)} instead of the ${when} sentence`,
  );
}

async function topLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const numbers = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="diff"] .editor.modified .line-numbers',
      ),
    ].map((line) => Number(line.innerText));
    return Math.min(...numbers.filter((line) => line > 0));
  });
}

async function watchMutations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target =
          record.target instanceof Element ? record.target : record.target.parentElement;
        if (target === null) continue;
        if (target.closest(".scrollbar") !== null) continue;
        seen.push(`${record.type} in ${(target.getAttribute("class") ?? "").slice(0, 60)}`);
      }
    });
    for (const id of ["changes-list", "diff"]) {
      const element = document.querySelector(`[data-testid="${id}"]`);
      if (element !== null) {
        observer.observe(element, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
      }
    }
    Reflect.set(window, "changesMutations", { observer, seen });
  });
}

async function mutationsSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const watched: unknown = Reflect.get(window, "changesMutations");
    if (typeof watched !== "object" || watched === null) return ["nothing was watched"];
    const observer: unknown = Reflect.get(watched, "observer");
    if (observer instanceof MutationObserver) observer.disconnect();
    const seen: unknown = Reflect.get(watched, "seen");
    return Array.isArray(seen) ? seen.map(String) : ["nothing was recorded"];
  });
}

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((hide) => {
    if (hide) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function listsBranch(session: AppSession): Promise<void> {
  const { page } = session;
  await page.getByTestId("workspace-repo-alpha").click();
  let listed: Row[] = [];
  await waitUntil(
    async () => {
      listed = await rows(page);
      return listed.length === branchRows.length;
    },
    waitMs,
    () => `Branch listed ${String(listed.length)} rows instead of ${String(branchRows.length)}`,
  );
  for (const [path, letter] of branchRows) {
    const row = listed.find((shown) => shown.path.normalize("NFC") === path.normalize("NFC"));
    assert.ok(row !== undefined, `Branch did not list ${JSON.stringify(path)}`);
    assert.equal(row.state, letter, `${JSON.stringify(path)} read ${row.state}, not ${letter}`);
  }
  const app = listed.find((row) => row.path === "src/app.ts");
  assert.ok(
    app?.text.includes("+2") && app.text.includes("−1"),
    `src/app.ts read ${app?.text ?? "nothing"}`,
  );
  const report = listed.find((row) => row.path.includes("report"));
  assert.ok(
    report?.text.includes("[U+202E]"),
    `the report row hid its direction override, it read ${JSON.stringify(report?.text)}`,
  );
}

async function showsDiffReadOnly(session: AppSession): Promise<void> {
  const { page } = session;
  await select(session, "src/app.ts");
  await page.locator('[data-testid="diff"] .editor.original').waitFor({ timeout: waitMs });
  await modifiedShows(session, "greeting", "for src/app.ts");
  const before = await sideText(page, "modified");
  await page
    .locator('[data-testid="diff"] .editor.modified .lines-content > .view-lines')
    .first()
    .click();
  await page.waitForFunction(() => document.activeElement?.closest("[data-testid='diff']"));
  await page.keyboard.type("zz");
  await page.keyboard.press("Enter");
  assert.equal(await sideText(page, "modified"), before, "typing into the diff changed it");
  const violations = await page.evaluate((): unknown => Reflect.get(window, "policyViolations"));
  assert.deepEqual(violations, [], "the diff broke the content security policy");
}

async function listsUncommitted(session: AppSession): Promise<void> {
  const { page } = session;
  await page.getByTestId("changes-view-uncommitted").click();
  let listed: string[] = [];
  await waitUntil(
    async () => {
      listed = (await rows(page)).map((row) => row.path);
      return [...listed].sort().join("\n") === [...uncommittedRows].sort().join("\n");
    },
    waitMs,
    () => `Uncommitted listed ${JSON.stringify(listed)}`,
  );
}

async function untilQuiet(page: Page): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await watchMutations(page);
    await delay(quietMs);
    if ((await mutationsSeen(page)).length === 0) return;
  }
  throw new Error("the diff never stopped drawing after it opened");
}

async function staysStill(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  await select(session, "README.md");
  await modifiedShows(session, "Edited by the agent.", "for README.md");
  await untilQuiet(page);
  await watchMutations(page);
  const later = new Date(Date.now() + 60_000);
  await utimes(join(folder, "README.md"), later, later);
  await nudge(page);
  await delay(settleMs / 2);
  await nudge(page);
  await delay(settleMs / 2);
  const seen = await mutationsSeen(page);
  assert.deepEqual(
    seen,
    [],
    `the list or the diff changed while only a file's time did, ${seen.slice(0, 5).join(", ")}`,
  );
}

async function followsTheDisk(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  await writeFile(join(folder, "live.txt"), "written while you watch\n");
  const live = await rowOf(session, "live.txt", "without any click", false, pollCapMs + waitMs);
  assert.equal(live.state, "A", `live.txt read ${live.state}, not A`);
  await select(session, "live.txt");
  await page.locator('[data-testid="diff"][data-side="modified"]').waitFor({ timeout: waitMs });
  assert.equal(
    await page.locator('[data-testid="diff"] .editor.original').count(),
    0,
    "an added file showed an empty side opposite",
  );

  await setHidden(page, true);
  await delay(settleMs);
  await writeFile(join(folder, "unseen.txt"), "written while hidden\n");
  await delay(settleMs);
  const hiddenRows = await rows(page);
  assert.ok(
    !hiddenRows.some((row) => row.path === "unseen.txt"),
    "the list refreshed while the window was hidden",
  );
  await setHidden(page, false);
  await rowOf(session, "unseen.txt", "once the window was visible again", false);

  await select(session, "README.md");
  await appendFile(join(folder, "README.md"), "Another line.\n");
  await nudge(page);
  await waitUntil(
    async () => (await rowOf(session, "README.md", "after the append")).text.includes("+3"),
    waitMs,
    "README.md never counted +3 after the append",
  );
  await modifiedShows(session, "Another line.", "after the append");
}

async function keepsThePlace(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  const many = Array.from({ length: 200 }, (_, index) => `line ${String(index + 1)}\n`).join("");
  await appendFile(join(folder, "README.md"), many);
  await nudge(page);
  await modifiedShows(session, "line 1", "after 200 lines were added");
  await page.locator('[data-testid="diff"] .editor.modified').hover();
  let before = 0;
  await waitUntil(
    async () => {
      await page.mouse.wheel(0, 600);
      before = await topLine(page);
      return before > 40;
    },
    waitMs,
    () => `the diff did not scroll, its top line stayed ${String(before)}`,
  );
  const lines = (await readFile(join(folder, "README.md"), "utf8")).split("\n");
  const edited = before + 1;
  lines[edited] = `${lines[edited] ?? ""} edited in view`;
  await writeFile(join(folder, "README.md"), lines.join("\n"));
  await nudge(page);
  await modifiedShows(session, "edited in view", "after a visible line was edited");
  const after = await topLine(page);
  assert.equal(after, before, `the diff jumped from line ${String(before)} to ${String(after)}`);
  assert.ok(
    (await rowOf(session, "README.md", "after the refresh")).current,
    "README.md lost its selection",
  );
}

async function refreshesWhenATurnEnds(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  await startClaude(session, 1);
  await page.keyboard.type("look at the changes");
  await writeFile(join(folder, "turn-a.txt"), "a\n");
  await rowOf(session, "turn-a.txt", "before the turn ended");
  await delay(backoffMs);
  await writeFile(join(folder, "turn-b.txt"), "b\n");
  await page.keyboard.press("Enter");
  await rowOf(session, "turn-b.txt", "after the turn ended", false, turnRefreshMs);
  await stateIs(session, "session-tab-1", "done", "after the turn ended");
}

async function showsSentences(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  await select(session, "logo.bin");
  await sentenceReads(session, binarySentence, "binary");

  await writeFile(join(folder, "latin.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  await rowOf(session, "latin.txt", "after latin.txt was written");
  await select(session, "latin.txt");
  await sentenceReads(session, notUtf8Sentence, "not UTF-8");

  await writeFile(join(folder, "big.txt"), "line\n".repeat(30_000));
  await rowOf(session, "big.txt", "after big.txt was written");
  await select(session, "big.txt");
  await sentenceReads(session, largeSentence, "large");
  const began = Date.now();
  await page.evaluate(() => 1);
  assert.ok(Date.now() - began < quickMs, "the window froze on a large file");
}

async function revealsHiddenText(session: AppSession, folder: string): Promise<void> {
  const { page } = session;
  await writeFile(join(folder, "src", "app.ts"), hostileApp);
  await rowOf(session, "src/app.ts", "after src/app.ts was rewritten");
  await select(session, "src/app.ts");
  await modifiedShows(session, "[U+200B][U+17B4]", "for the zero-width space and the Khmer vowel");
  await modifiedShows(session, "␍", "for the carriage returns");
  const markCount = () => page.locator('[data-testid="diff"] .editor.modified .look-alike').count();
  let marks = 0;
  await waitUntil(
    async () => {
      marks = await markCount();
      return marks === 2;
    },
    waitMs,
    () =>
      `the Cyrillic letter and the Greek question mark were marked ${String(marks)} times, not twice`,
  );
  const revealedCount = () =>
    page.locator('[data-testid="diff"] .editor.modified .revealed').count();
  let revealed = 0;
  await waitUntil(
    async () => {
      revealed = await revealedCount();
      return revealed >= 2;
    },
    waitMs,
    () => `only ${String(revealed)} revealed runs drew in their own style`,
  );
  assert.equal(await page.locator(".editor-banner").count(), 0, "the editor showed its own banner");
  const lastLine = await page.evaluate(() =>
    Math.max(
      ...[
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="diff"] .editor.modified .line-numbers',
        ),
      ].map((line) => Number(line.innerText) || 0),
    ),
  );
  const gitLines = hostileApp.split("\n").length;
  assert.equal(
    lastLine,
    gitLines,
    `the diff drew ${String(lastLine)} lines, git has ${String(gitLines)}`,
  );
}

async function typedAfter(session: AppSession, from: number, expected: string): Promise<void> {
  let typed = "";
  await waitUntil(
    async () => {
      typed = await standInInput(session, from);
      return typed.length >= expected.length;
    },
    promptTimeoutMs,
    () => `the prompt received ${JSON.stringify(typed)}`,
  );
  assert.equal(typed, expected, `the prompt received ${JSON.stringify(typed)}`);
  assert.ok(!typed.includes("\r"), "the reference was submitted");
}

async function sendsLines(session: AppSession): Promise<void> {
  const { page } = session;
  await stateIs(session, "session-tab-1", "done", "before the lines were sent");
  await page.getByTestId("changes-view-branch").click();

  await select(session, "src/app.ts");
  await page.locator('[data-testid="diff"] .editor.modified').waitFor();
  let from = (await session.standInEvents()).length;
  await page
    .locator('[data-testid="diff"] .editor.modified .lines-content > .view-lines')
    .first()
    .click();
  await page.waitForFunction(() => document.activeElement?.closest("[data-testid='diff']"));
  await page.keyboard.press(shortcut);
  await toastReads(session, noLinesSentence, "after pressing the shortcut with nothing selected");
  assert.equal(await standInInput(session, from), "", "lines nobody selected reached the prompt");
  await session.selectDiffLines("modified", 2, 3);
  await page.keyboard.press(shortcut);
  await typedAfter(session, from, bracketed("Lines 2 to 3 of src/app.ts in this workspace. "));
  await terminalFocused(session);

  if ((await page.getByTestId("diff-inline").count()) > 0) {
    await select(session, "caf\u{e9} notes.md");
    await page.locator('[data-testid="diff"] .editor.original').waitFor();
    from = (await session.standInEvents()).length;
    await session.selectDiffLines("original", 1, 1);
    await page.keyboard.press(shortcut);
    await typedAfter(
      session,
      from,
      bracketed("Line 1 of notes.md at the merge base with origin/main. "),
    );
  }

  await select(session, "report\u{202e}txt.md");
  await page.locator('[data-testid="diff"][data-side="modified"]').waitFor();
  from = (await session.standInEvents()).length;
  await session.selectDiffLines("modified", 1, 1);
  await page.keyboard.press(shortcut);
  await toastReads(session, hiddenNameSentence, "after sending lines of a hidden name");
  assert.equal(await standInInput(session, from), "", "a hidden name reached the prompt");

  await select(session, "src/app.ts");
  await page.locator('[data-testid="diff"] .editor.modified').waitFor();
  await page.getByTestId("new-session").click();
  await stateIs(session, "session-tab-2", "idle", "for the second session");
  from = (await session.standInEvents()).length;
  await page.keyboard.press(shortcut);
  assert.ok(
    !(await standInInput(session, from)).includes("Lines"),
    "the shortcut sent a reference with focus in the terminal",
  );
  await session.selectDiffLines("modified", 2, 3);
  await page.keyboard.press(shortcut);
  await toastReads(session, notReadySentence, "after sending lines to a session not ready");
  assert.equal(await standInInput(session, from), "", "lines reached a session not ready");
}

export const changesJourney: Journey = {
  name: "changes",
  scenario: "mixed-changes",
  async run(session) {
    const folder = worktree(session);
    await session.page.evaluate(() => {
      const violations: string[] = [];
      Reflect.set(window, "policyViolations", violations);
      document.addEventListener("securitypolicyviolation", (event) => {
        violations.push(event.violatedDirective);
      });
    });
    await listsBranch(session);
    await showsDiffReadOnly(session);
    await listsUncommitted(session);
    await staysStill(session, folder);
    await followsTheDisk(session, folder);
    await keepsThePlace(session, folder);
    await refreshesWhenATurnEnds(session, folder);
    await showsSentences(session, folder);
    await revealsHiddenText(session, folder);
    await sendsLines(session);
    await session.screenshot("changes");
    assert.deepEqual(session.consoleErrors, [], "the window logged errors");
  },
};
