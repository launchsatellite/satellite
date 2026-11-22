import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AppSession } from "../driver.ts";
import type { Journey } from "../journeys.ts";
import {
  gone,
  promptTimeoutMs,
  standInInput,
  startClaude,
  terminalFocused,
  toastReads,
  visible,
  waitUntil,
} from "./conditions.ts";

type GuideStep = 1 | 2 | 3 | 4;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Words {
  readout: string;
  title: string;
  text: string;
  button: string;
  status: string;
}

interface Size {
  width: number;
  height: number;
}

interface Reading {
  control: Box;
  ring: Box;
  card: Box;
  tail: Box;
  window: Size;
}

const commandModifier = process.platform === "darwin" ? "Meta" : "Control+Shift";
const narrowest: Size = { width: 960, height: 600 };
const tolerance = 1;
const closedSentence = "The guide is closed. Show the guide in the command menu opens it again.";
const savedFile = z.object({ version: z.literal(4), guideSeen: z.literal(true) });
const legendWords = ["idle", "working", "needs you", "done"];
const anchors: Record<
  GuideStep,
  { anchor: string; side: "right" | "left" | "below"; band?: { height: number; below: number } }
> = {
  1: { anchor: "workspace", side: "right" },
  2: { anchor: "session", side: "left" },
  3: { anchor: "views", side: "below" },
  4: { anchor: "inbox", side: "right", band: { height: 28, below: 2 } },
};
const words: Record<GuideStep, Words> = {
  1: {
    readout: "01 / 04",
    title: "make a workspace",
    text: "A workspace is a git worktree and a branch made in one step, so agents work side by side and never in each other's files.",
    button: "Next",
    status:
      "Step 1 of 4. make a workspace. A workspace is a git worktree and a branch made in one step, so agents work side by side and never in each other's files.",
  },
  2: {
    readout: "02 / 04",
    title: "start Claude Code",
    text: "This is your own Claude Code in a real terminal, with your settings and skills, and its prompt is the only place you type.",
    button: "Next",
    status:
      "Step 2 of 4. start Claude Code. This is your own Claude Code in a real terminal, with your settings and skills, and its prompt is the only place you type.",
  },
  3: {
    readout: "03 / 04",
    title: "read what it did",
    text: "Changes, Files and Pull request show the work in this workspace, read only, because your agent does the writing.",
    button: "Next",
    status:
      "Step 3 of 4. read what it did. Changes, Files and Pull request show the work in this workspace, read only, because your agent does the writing.",
  },
  4: {
    readout: "04 / 04",
    title: "orange means you",
    text: "A square pixel shows the state of each session, and signal orange means one cannot go on without you, so it waits in the inbox.",
    button: "Done",
    status:
      "Step 4 of 4. orange means you. A square pixel shows the state of each session, and signal orange means one cannot go on without you, so it waits in the inbox.",
  },
};

function bandOf(row: Box, band: { height: number; below: number } | undefined): Box {
  if (band === undefined) return row;
  return {
    left: row.left,
    width: row.width,
    height: band.height,
    top: row.top + row.height + band.below - band.height,
  };
}

function describe(value: unknown): string {
  return JSON.stringify(value);
}

async function settled(session: AppSession): Promise<void> {
  await session.page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

async function textOf(session: AppSession, testId: string): Promise<string> {
  return ((await session.page.getByTestId(testId).textContent()) ?? "").trim();
}

async function focusedId(session: AppSession): Promise<string> {
  return session.page.evaluate(
    () => document.activeElement?.closest("[data-testid]")?.getAttribute("data-testid") ?? "",
  );
}

async function focusInCard(session: AppSession): Promise<boolean> {
  return session.page.evaluate(
    () =>
      document.querySelector('[data-testid="guide-card"]')?.contains(document.activeElement) ===
      true,
  );
}

async function stepShows(
  session: AppSession,
  step: GuideStep,
  when: string,
  focusAsked = false,
): Promise<void> {
  const card = session.page.locator(`[data-testid="guide-card"][data-step="${String(step)}"]`);
  await card.waitFor({ state: "visible", timeout: promptTimeoutMs }).catch(() => {
    throw new Error(`the card for step ${String(step)} did not show ${when}`);
  });
  const expected = words[step];
  assert.equal(await textOf(session, "guide-readout"), expected.readout, `readout ${when}`);
  assert.equal(await textOf(session, "guide-title"), expected.title, `title ${when}`);
  assert.equal(await textOf(session, "guide-text"), expected.text, `sentence ${when}`);
  const button = step === 4 ? "guide-done" : "guide-next";
  assert.equal(await textOf(session, button), expected.button, `button ${when}`);
  await waitUntil(
    async () => (await textOf(session, "guide-status")) === expected.status,
    promptTimeoutMs,
    "the status region did not read the step",
  );
  if (!focusAsked) {
    assert.ok(!(await focusInCard(session)), `step ${String(step)} took focus ${when}`);
  }
}

async function reading(session: AppSession, step: GuideStep): Promise<Reading | null> {
  const { anchor } = anchors[step];
  return session.page.evaluate((name) => {
    const box = (element: Element | null) => {
      if (element === null) return null;
      const { left, top, width, height } = element.getBoundingClientRect();
      return { left, top, width, height };
    };
    const control = box(document.querySelector(`[data-guide="${name}"]`));
    const ring = box(document.querySelector('[data-testid="guide-ring"]'));
    const card = box(document.querySelector('[data-testid="guide-card"]'));
    const tail = box(document.querySelector('[data-testid="guide-tail"]'));
    if (control === null || ring === null || card === null || tail === null) return null;
    return { control, ring, card, tail, window: { width: innerWidth, height: innerHeight } };
  }, anchor);
}

function problem(step: GuideStep, read: Reading | null): string | null {
  if (read === null) return "the control, ring, card or tail was missing";
  const { side, band } = anchors[step];
  const control = bandOf(read.control, band);
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  const { ring, card, tail } = read;
  const ringIsGrown =
    near(ring.left, control.left - 4) &&
    near(ring.top, control.top - 4) &&
    near(ring.width, control.width + 8) &&
    near(ring.height, control.height + 8);
  if (!ringIsGrown) return "the ring was not the control grown by 4";
  const gap = {
    right: card.left - (control.left + control.width),
    left: control.left - (card.left + card.width),
    below: card.top - (control.top + control.height),
  }[side];
  if (!near(gap, 32)) return `the card was ${String(gap)} from the control instead of 32`;
  const alongX = side === "below";
  const controlMiddle = alongX
    ? control.left + control.width / 2
    : control.top + control.height / 2;
  const tailMiddle = alongX ? tail.left + tail.width / 2 : tail.top + tail.height / 2;
  if (!near(tailMiddle, controlMiddle)) {
    return `the tail's middle was ${String(tailMiddle)} instead of ${String(controlMiddle)}`;
  }
  const inside =
    card.left >= 0 &&
    card.top >= 0 &&
    card.left + card.width <= read.window.width &&
    card.top + card.height <= read.window.height;
  if (!inside) return "the card was not inside the window";
  const apart =
    card.left >= control.left + control.width ||
    card.left + card.width <= control.left ||
    card.top >= control.top + control.height ||
    card.top + card.height <= control.top;
  return apart ? null : "the card covered the control";
}

async function sitsBeside(session: AppSession, step: GuideStep, when: string): Promise<void> {
  let last: Reading | null = null;
  let why: string | null = null;
  await waitUntil(
    async () => {
      last = await reading(session, step);
      why = problem(step, last);
      return why === null;
    },
    promptTimeoutMs,
    () => `step ${String(step)} ${when}, ${String(why)}, last read ${describe(last)}`,
  );
}

async function tokenColour(session: AppSession, token: string): Promise<string> {
  return session.page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

async function looks(session: AppSession, step: GuideStep): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await session.page.emulateMedia({ colorScheme: scheme });
    let read = { card: "", ring: "" };
    let expected = { card: "", ring: "" };
    await waitUntil(
      async () => {
        expected = {
          card: await tokenColour(session, "raised"),
          ring: await tokenColour(session, "fg2"),
        };
        read = await session.page.evaluate(() => ({
          card: getComputedStyle(
            document.querySelector('[data-testid="guide-card"]') ?? document.body,
          ).backgroundColor,
          ring: getComputedStyle(
            document.querySelector('[data-testid="guide-ring"]') ?? document.body,
          ).borderTopColor,
        }));
        return read.card === expected.card && read.ring === expected.ring;
      },
      promptTimeoutMs,
      () =>
        `step ${String(step)} in ${scheme} read ${describe(read)} instead of ${describe(expected)}`,
    );
    await settled(session);
    await session.screenshot(`guide-${String(step)}-${scheme}`);
  }
  await session.page.emulateMedia({ colorScheme: "light" });
}

async function everySize(session: AppSession, step: GuideStep): Promise<void> {
  const first = await session.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await sitsBeside(session, step, `at ${describe(first)}`);
  await session.page.setViewportSize(narrowest);
  try {
    await sitsBeside(session, step, "at 960 by 600");
    await looks(session, step);
  } finally {
    await session.page.setViewportSize(first);
  }
  await sitsBeside(session, step, `back at ${describe(first)}`);
}

async function savedAsSeen(session: AppSession): Promise<void> {
  let read = "";
  await waitUntil(
    async () => {
      read = await readFile(join(session.home, "interface.json"), "utf8").catch(() => "");
      try {
        return savedFile.safeParse(JSON.parse(read)).success;
      } catch {
        return false;
      }
    },
    promptTimeoutMs,
    () => `interface.json did not hold version 4 with guideSeen true, it read ${read.slice(0, 80)}`,
  );
}

async function showGuide(session: AppSession): Promise<void> {
  await session.page.keyboard.press(`${commandModifier}+K`);
  await session.page.getByTestId("palette-input").fill("guide");
  await visible(session, "command-guide-show", "in the command menu for guide");
  await session.page.keyboard.press("Enter");
}

async function cardFocused(session: AppSession, when: string): Promise<void> {
  await waitUntil(
    async () => (await focusedId(session)) === "guide-card",
    promptTimeoutMs,
    `the card did not take focus ${when}`,
  );
}

async function restarted(session: AppSession): Promise<void> {
  await session.relaunch();
  await session.page.emulateMedia({ colorScheme: "light" });
  await visible(session, "project-repo", "after the restart");
  await settled(session);
}

async function columnBoxes(session: AppSession): Promise<Box[]> {
  return session.page.evaluate(() =>
    ["column-projects", "column-repository", "column-sessions"].map((id) => {
      const { left, top, width, height } =
        document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect() ?? new DOMRect();
      return { left, top, width, height };
    }),
  );
}

async function moveControl(session: AppSession, step: GuideStep, away: boolean): Promise<void> {
  const { anchor } = anchors[step];
  await session.page.evaluate(
    ([name, out]) => {
      const control = document.querySelector<HTMLElement>(`[data-guide="${String(name)}"]`);
      if (control === null) throw new Error(`no control for ${String(name)}`);
      if (out === true) control.style.transform = "translateY(4000px)";
      else control.style.removeProperty("transform");
    },
    [anchor, away],
  );
  if (!away) {
    const size = await session.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await session.page.setViewportSize({ width: size.width + 1, height: size.height });
    await session.page.setViewportSize(size);
  }
}

async function cardCouldFit(session: AppSession): Promise<void> {
  const { card, window } = await session.page.evaluate(() => ({
    card: document.querySelector('[data-testid="guide-card"]')?.getBoundingClientRect().height ?? 0,
    window: innerHeight,
  }));
  assert.ok(
    card > 0 && card + 16 <= window,
    `the card could not fit in a window ${String(window)} high`,
  );
}

async function countLookups(session: AppSession): Promise<void> {
  await session.page.evaluate(() => {
    const original: unknown = Reflect.get(Document.prototype, "querySelector");
    if (typeof original !== "function") throw new Error("no querySelector");
    Reflect.set(window, "guideLookups", 0);
    Reflect.set(
      Document.prototype,
      "querySelector",
      function lookup(this: Document, ...rest: [string]) {
        if (rest[0].includes("data-guide")) {
          Reflect.set(window, "guideLookups", Number(Reflect.get(window, "guideLookups")) + 1);
        }
        const found: unknown = Reflect.apply(original, this, rest);
        return found;
      },
    );
  });
}

async function lookupsOver(session: AppSession, ms: number): Promise<number> {
  const read = () => session.page.evaluate(() => Number(Reflect.get(window, "guideLookups")));
  const before = await read();
  await session.page.waitForTimeout(ms);
  return (await read()) - before;
}

async function noCard(session: AppSession, when: string): Promise<void> {
  await settled(session);
  assert.equal(await session.page.getByTestId("guide-card").count(), 0, `a card showed ${when}`);
  assert.equal(await session.page.getByTestId("guide-ring").count(), 0, `a ring showed ${when}`);
}

async function cardHidden(session: AppSession, when: string): Promise<void> {
  await waitUntil(
    async () => !(await session.page.getByTestId("guide-card").isVisible()),
    promptTimeoutMs,
    `the card stayed visible ${when}`,
  );
  assert.equal(await session.page.getByTestId("guide-ring").count(), 0, `the ring stayed ${when}`);
}

async function watchStatus(session: AppSession): Promise<void> {
  await session.page.evaluate(() => {
    const reads: string[] = [];
    const status = document.querySelector('[data-testid="guide-status"]');
    if (status === null) throw new Error("no status region");
    new MutationObserver(() => {
      reads.push(status.textContent);
    }).observe(status, { childList: true, characterData: true, subtree: true });
    Reflect.set(window, "guideReads", reads);
  });
}

async function statusReads(session: AppSession): Promise<string[]> {
  return session.page.evaluate(() => {
    const reads: unknown = Reflect.get(window, "guideReads");
    return Array.isArray(reads) ? reads.filter((read) => typeof read === "string") : [];
  });
}

async function firstPass(session: AppSession): Promise<void> {
  await session.page.emulateMedia({ colorScheme: "light" });
  await visible(session, "check-count", "on the welcome screen");
  await noCard(session, "on the welcome screen");

  await session.answerFolderDialog(session.repo);
  await session.page.getByTestId("add-first-project").click();
  await stepShows(session, 1, "after the first project");
  await everySize(session, 1);

  await restarted(session);
  await stepShows(session, 1, "after a restart in the middle");

  await countLookups(session);
  await settled(session);
  assert.equal(
    await lookupsOver(session, 500),
    0,
    "the layer looked the control up again while nothing moved",
  );
  await watchStatus(session);
  await cardCouldFit(session);
  await moveControl(session, 1, true);
  try {
    await cardHidden(session, "with the control out of the window");
  } finally {
    await moveControl(session, 1, false);
  }
  await stepShows(session, 1, "with the control back");
  await sitsBeside(session, 1, "with the control back");
  assert.deepEqual(
    (await statusReads(session)).filter((read) => read !== ""),
    [],
    "the status region spoke again when the card hid and returned",
  );

  await moveControl(session, 2, true);
  await session.page.getByTestId("guide-next").click();
  await cardHidden(session, "after Next with the next control out of the window");
  assert.deepEqual(
    (await statusReads(session)).filter((read) => read !== ""),
    [],
    "a step was spoken before its card was placed",
  );
  await moveControl(session, 2, false);
  await stepShows(session, 2, "after Next from step 1");
  assert.deepEqual(
    (await statusReads(session)).filter((read) => read !== ""),
    [words[2].status],
    "step 2 was not spoken once, with its card",
  );
  await everySize(session, 2);
  await session.page.getByTestId("guide-next").click();
  await stepShows(session, 3, "after Next from step 2");
  await everySize(session, 3);
  await session.page.getByTestId("guide-next").click();
  await stepShows(session, 4, "after Next from step 3");
  const legend = await session.page.locator('[data-testid="guide-legend"] li').allInnerTexts();
  assert.deepEqual(
    legend.map((word) => word.trim()),
    legendWords,
    "the legend",
  );
  assert.equal(
    await session.page.locator('[data-testid="guide-legend"] [data-state="needs-you"]').count(),
    1,
    "the legend held more or less than one needs you pixel",
  );
  await everySize(session, 4);
  await settled(session);
  const columns = await columnBoxes(session);

  await session.page.getByTestId("guide-close").click();
  await gone(session, "guide-card", "after the close control");
  assert.deepEqual(await columnBoxes(session), columns, "closing the guide moved a column");
  await toastReads(session, closedSentence, "after closing the guide early");

  await showGuide(session);
  await stepShows(session, 1, "after Show the guide at once", true);
  assert.equal(
    await session.page.getByTestId("toast").count(),
    0,
    "the closed toast stayed up beside the reopened guide",
  );
  await cardFocused(session, "after Show the guide at once");
  await session.page.getByTestId("guide-close").click();
  await gone(session, "guide-card", "after the close control with the mouse");
  await settled(session);
  assert.equal(
    await session.page.evaluate(() => document.querySelector(":focus-visible")?.outerHTML ?? ""),
    "",
    "a mouse close left a focus ring on a control",
  );
  await toastReads(session, closedSentence, "after closing the guide again");
  await savedAsSeen(session);
  await restarted(session);
  await noCard(session, "after an early close and a restart");
}

async function secondPass(session: AppSession): Promise<string> {
  await showGuide(session);
  await stepShows(session, 1, "after Show the guide", true);
  await cardFocused(session, "after Show the guide");

  await session.page.getByTestId("new-workspace-repo").click();
  await visible(session, "create-workspace", "after New workspace was pressed");
  let name = "";
  await waitUntil(
    async () => {
      name = await session.page.getByTestId("workspace-name").inputValue();
      return name !== "";
    },
    promptTimeoutMs,
    "the New workspace dialog suggested no name",
  );
  await cardHidden(session, "under the New workspace dialog");
  assert.equal(await focusedId(session), "workspace-name", "the dialog lost focus");
  await session.page.getByTestId("create-workspace").click();
  await waitUntil(
    async () =>
      (await session.page.getByTestId(`workspace-repo-${name}`).count()) > 0 &&
      (await session.page.getByTestId(`workspace-repo-${name}`).getAttribute("aria-current")) ===
        "true",
    promptTimeoutMs,
    `workspace-repo-${name} was not selected`,
  );
  await stepShows(session, 2, "after making a workspace", true);
  await sitsBeside(session, 2, "after making a workspace");

  await startClaude(session, 1);
  await stepShows(session, 3, "after a session started");
  await terminalFocused(session);

  const before = (await session.standInEvents()).length;
  await session.page.keyboard.press("Escape");
  await waitUntil(
    async () => (await standInInput(session, before)).includes("\u001b"),
    promptTimeoutMs,
    "Escape in the terminal never reached Claude Code",
  );
  await stepShows(session, 3, "after Escape in the terminal");

  await showGuide(session);
  await cardFocused(session, "after Show the guide with a session");
  const noted = (await session.standInEvents()).length;
  await session.page.keyboard.press("Escape");
  await gone(session, "guide-card", "after Escape in the card");
  await toastReads(session, closedSentence, "after Escape in the card");
  await terminalFocused(session);
  await session.page.keyboard.type("x");
  await waitUntil(
    async () => (await standInInput(session, noted)) === "x",
    promptTimeoutMs,
    "the Escape that closed the card reached Claude Code",
  );
  await restarted(session);
  await noCard(session, "after Escape in the card and a restart");
  return name;
}

async function thirdPass(session: AppSession, name: string): Promise<void> {
  await session.page.getByTestId(`workspace-repo-${name}`).click();
  await showGuide(session);
  await stepShows(session, 2, "after Show the guide with a workspace and no session", true);

  let presses = 0;
  while ((await focusedId(session)) !== "guide-next" && presses < 3) {
    await session.page.keyboard.press("Tab");
    presses += 1;
  }
  assert.equal(await focusedId(session), "guide-next", "Tab never reached Next from the card");
  await session.page.keyboard.press("Enter");
  await stepShows(session, 3, "after Enter on Next", true);
  assert.equal(await focusedId(session), "guide-next", "Next lost focus when the step changed");
  await session.page.keyboard.press("Enter");
  await stepShows(session, 4, "after the second Enter on Next", true);
  await waitUntil(
    async () => (await focusedId(session)) === "guide-done",
    promptTimeoutMs,
    "focus did not stay on the button that became Done",
  );
  await session.page.keyboard.press("Enter");
  await gone(session, "guide-card", "after Done");
  await settled(session);
  assert.equal(await session.page.getByTestId("toast").count(), 0, "Done showed a toast");
  assert.notEqual(await focusedId(session), "", "focus fell to the page after Done");

  await restarted(session);
  await noCard(session, "after Done and a restart");
}

async function edgePass(session: AppSession): Promise<void> {
  await moveControl(session, 2, true);
  try {
    await showGuide(session);
    await cardHidden(session, "with the control out of the window");
  } finally {
    await moveControl(session, 2, false);
  }
  await stepShows(session, 2, "once the control was back after a request with no card", true);
  assert.ok(!(await focusInCard(session)), "the card took focus later than the command asked");
  await cardCouldFit(session);
  await showGuide(session);
  await cardFocused(session, "after Show the guide again");

  await watchStatus(session);
  await session.page.getByTestId("new-workspace-repo").click();
  await visible(session, "create-workspace", "over the guide");
  await cardHidden(session, "under a dialog");
  await session.page.keyboard.press("Escape");
  await gone(session, "create-workspace", "after Escape in the dialog");
  await stepShows(session, 2, "after the dialog closed", true);

  await session.page.keyboard.press(`${commandModifier}+K`);
  await visible(session, "palette", "over the guide");
  await cardHidden(session, "under the command menu");
  await session.page.keyboard.press("Escape");
  await gone(session, "palette", "after Escape in the command menu");
  await stepShows(session, 2, "after the command menu closed", true);
  assert.deepEqual(
    (await statusReads(session)).filter((read) => read !== ""),
    [],
    "the status region spoke again when a dialog and the command menu came and went",
  );
  assert.ok(!(await focusInCard(session)), "the card took focus back after a dialog");

  await sitsBeside(session, 2, "after the command menu closed");

  const name = await session.page
    .getByTestId("archive-workspace")
    .evaluate(
      () =>
        document
          .querySelector("[aria-current='true'][data-testid^='workspace-repo-']")
          ?.getAttribute("data-testid") ?? "",
    );
  await session.page.getByTestId("archive-workspace").click();
  await visible(session, "archive-confirm", "before the removal");
  await session.page.getByTestId("archive-confirm").click();
  await gone(session, name, "after it was archived");
  await stepShows(session, 2, "after the workspace was archived", true);
  await showGuide(session);
  await cardFocused(session, "before the removal");
  await session.page.evaluate(() => {
    const remove = document.querySelector<HTMLElement>('[data-testid="remove-project"]');
    if (remove === null) throw new Error("no remove-project button");
    remove.click();
  });
  await gone(session, "guide-card", "after the last project was removed");
  await visible(session, "no-projects", "after the last project was removed");
  await noCard(session, "on the welcome screen after the removal");
  assert.ok(
    await session.page.evaluate(() => document.activeElement !== document.body),
    "focus fell to the page when the guide ended with focus in the card",
  );

  await session.answerFolderDialog(session.repo);
  await session.page.getByTestId("add-first-project").click();
  await settled(session);
  await noCard(session, "after the project was added again, since the guide was seen");
}

async function run(session: AppSession): Promise<void> {
  await firstPass(session);
  const name = await secondPass(session);
  await thirdPass(session, name);
  await edgePass(session);
  assert.deepEqual(session.consoleErrors, [], "the window logged errors");
}

export const guideJourney: Journey = {
  name: "guide",
  scenario: "first-run",
  run,
};
