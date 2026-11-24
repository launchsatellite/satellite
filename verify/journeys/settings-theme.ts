import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSession } from "../driver.ts";
import { readTerminal, type TerminalScreen } from "../terminal-screen.ts";
import { gone, startClaude, visible, waitUntil } from "./conditions.ts";

interface Look {
  tokens: Record<string, string>;
  theme: string | null;
  editorGround: string;
  syntax: Record<string, string>;
  removedSyntax: Record<string, string>;
  faces: Record<string, string>;
  inserted: string;
  removed: string;
  insertedWords: string;
  removedWords: string;
}

const waitMs = 15_000;
const commandModifier = process.platform === "darwin" ? "Meta" : "Control+Shift";
const settingsKeys = process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";
const siteAddress = "https://draculatheme.com/";
const tokenNames = [
  "bg",
  "side",
  "raised",
  "sel",
  "hover",
  "line",
  "ctl",
  "fg",
  "fg2",
  "dim",
  "accent",
  "signal",
  "working",
  "idle",
  "danger",
  "volt",
  "lilac",
];
const published = {
  bg: "#282a36",
  side: "#21222c",
  sel: "#44475a",
  fg: "#f8f8f2",
  dim: "#6272a4",
  accent: "#6272a4",
  working: "#a4ffff",
  signal: "#ffb86c",
  volt: "#50fa7b",
  lilac: "#bd93f9",
  idle: "#6272a4",
  danger: "#ff5555",
};
const publishedSyntax = {
  export: "rgb(255, 121, 198)",
  greet: "rgb(80, 250, 123)",
  string: "rgb(139, 233, 253)",
  Hello: "rgb(241, 250, 140)",
  '"': "rgb(233, 242, 132)",
  return: "rgb(255, 121, 198)",
};
const publishedRemoved = {
  return: "rgb(255, 121, 198)",
  Hello: "rgb(241, 250, 140)",
  "+": "rgb(255, 121, 198)",
};
const terminalRed = { satellite: "", theme: "#ff5555" };

async function look(session: AppSession): Promise<Look> {
  return session.page.evaluate((names) => {
    const root = getComputedStyle(document.documentElement);
    const diff = document.querySelector("[data-testid='diff']");
    const background = (selector: string) => {
      const found = diff?.querySelector(selector);
      return found === null || found === undefined ? "" : getComputedStyle(found).backgroundColor;
    };
    const gather = (
      spans: NodeListOf<Element> | undefined,
      value: (style: CSSStyleDeclaration) => string,
    ) => {
      const read = new Map<string, Set<string>>();
      for (const span of spans ?? []) {
        const text = span.textContent.trim();
        if (text === "") continue;
        const seen = read.get(text) ?? new Set<string>();
        seen.add(value(getComputedStyle(span)));
        read.set(text, seen);
      }
      return Object.fromEntries(
        [...read]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([text, seen]) => [text, [...seen].sort().join(" | ")]),
      );
    };
    const shownSpans = diff?.querySelectorAll(".view-line span span:not(.view-zones *)");
    const removedSpans = diff?.querySelectorAll(".view-zones .view-line span span");
    const syntax = gather(shownSpans, (style) => style.color);
    const removedSyntax = gather(removedSpans, (style) => style.color);
    const faces = gather(shownSpans, (style) => `${style.fontWeight} ${style.fontStyle}`);
    const paint = document.createElement("canvas").getContext("2d");
    const hex = (value: string) => {
      if (paint === null) return value;
      paint.fillStyle = "#000000";
      paint.fillStyle = value;
      return paint.fillStyle;
    };
    return {
      tokens: Object.fromEntries(
        names.map((name) => [name, hex(root.getPropertyValue(`--${name}`).trim())]),
      ),
      theme: document.documentElement.getAttribute("data-theme"),
      editorGround: background(".monaco-editor-background"),
      syntax,
      removedSyntax,
      faces,
      inserted: background(".line-insert"),
      removed: background(".line-delete"),
      insertedWords: background(".char-insert"),
      removedWords: background(".char-delete"),
    };
  }, tokenNames);
}

async function shows(session: AppSession, bg: string, when: string): Promise<Look> {
  let last: Look | undefined;
  await waitUntil(
    async () => {
      last = await look(session);
      const coloured = (read: Record<string, string>) => new Set(Object.values(read)).size >= 2;
      return (
        last.tokens["bg"] === bg &&
        last.editorGround !== "" &&
        last.inserted !== "" &&
        coloured(last.syntax) &&
        coloured(last.removedSyntax)
      );
    },
    waitMs,
    () => `the window did not show the ground ${bg} ${when}, it read ${JSON.stringify(last)}`,
  );
  if (last === undefined) throw new Error(`nothing was read ${when}`);
  return last;
}

async function settled(session: AppSession, expected: Look, when: string): Promise<void> {
  let last: Look | undefined;
  await waitUntil(
    async () => {
      last = await look(session);
      return JSON.stringify(last) === JSON.stringify(expected);
    },
    waitMs,
    () =>
      `the window did not return to ${JSON.stringify(expected)} ${when}, it read ${JSON.stringify(last)}`,
  );
}

async function themedSyntax(session: AppSession, when: string): Promise<void> {
  let last: Look | undefined;
  await waitUntil(
    async () => {
      last = await look(session);
      return (
        Object.entries(publishedSyntax).every(([text, colour]) => last?.syntax[text] === colour) &&
        Object.entries(publishedRemoved).every(
          ([text, colour]) => last?.removedSyntax[text] === colour,
        )
      );
    },
    waitMs,
    () =>
      `the syntax did not take the theme's colours ${when}, it read ${JSON.stringify(last?.syntax)} and removed ${JSON.stringify(last?.removedSyntax)}`,
  );
}

function fullHex(colour: string): string {
  return /^#[0-9a-f]{3}$/i.test(colour) ? colour.replace(/[0-9a-f]/gi, "$&$&") : colour;
}

async function terminalReads(
  session: AppSession,
  ground: string,
  red: string,
  when: string,
): Promise<void> {
  let last: TerminalScreen | null = null;
  await waitUntil(
    async () => {
      last = await readTerminal(session.page);
      return last !== null && fullHex(last.background) === ground && last.red === red;
    },
    waitMs,
    () =>
      `the terminal was not given ${ground} with red ${red || "its default"} ${when}, it read ${JSON.stringify({ background: last?.background, red: last?.red })}`,
  );
}

async function savedTheme(session: AppSession): Promise<unknown> {
  const state: unknown = JSON.parse(await readFile(join(session.home, "interface.json"), "utf8"));
  return typeof state === "object" && state !== null ? Reflect.get(state, "theme") : null;
}

async function openSettings(session: AppSession): Promise<void> {
  await session.page.keyboard.press(settingsKeys);
  await visible(session, "settings-dialog", "after the settings shortcut");
}

async function closeSettings(session: AppSession): Promise<void> {
  await session.page.keyboard.press("Escape");
  await gone(session, "settings-dialog", "after Escape");
}

async function runCommand(session: AppSession, id: string): Promise<void> {
  await session.page.keyboard.press(`${commandModifier}+K`);
  await visible(session, "palette", "after the command menu shortcut");
  await session.page.getByTestId(`command-${id}`).click();
  await gone(session, "palette", `after running ${id}`);
}

async function checkCredit(session: AppSession): Promise<void> {
  const credit = await session.page.getByTestId("settings-theme-credit").innerText();
  assert.match(credit, /^Dracula is made by the Dracula Theme team .* MIT licence\.$/);
  await session.page.getByTestId("settings-theme-site").click();
  await visible(session, "link-dialog", "after Open the theme's site");
  assert.equal(await session.page.getByTestId("link-address").innerText(), siteAddress);
  await session.page.getByTestId("link-cancel").click();
  await gone(session, "link-dialog", "after cancelling the theme's site");
  assert.ok(!(await session.openedLinks()).includes(siteAddress), "the site opened on Cancel");
}

export async function checkCuratedTheme(session: AppSession): Promise<void> {
  await closeSettings(session);
  await session.page.getByTestId("workspace-repo-feature").click();
  await startClaude(session, 1);
  const satellite = await shows(session, "#ffffff", "in Satellite's light theme");
  assert.equal(satellite.theme, null);
  await terminalReads(session, "#ffffff", terminalRed.satellite, "in Satellite's light theme");
  await session.page.getByTestId("workspace-repo-main").click();
  await openSettings(session);
  await session.page.getByTestId("settings-theme").selectOption({ label: "Dracula" });
  await checkCredit(session);
  await session.screenshot("settings-theme-dracula");
  await closeSettings(session);
  await session.page.getByTestId("workspace-repo-feature").click();
  const themed = await shows(session, published.bg, "after choosing the curated theme");
  assert.deepEqual(
    Object.fromEntries(Object.keys(published).map((name) => [name, themed.tokens[name]])),
    published,
  );
  assert.equal(themed.theme, "dracula");
  assert.deepEqual(
    await session.page.evaluate(() => {
      const selected = document.querySelector(".bg-sel");
      const read = (name: string) =>
        selected === null ? "" : getComputedStyle(selected).getPropertyValue(name).trim();
      return { dim: read("--dim"), idle: read("--idle") };
    }),
    { dim: "#b1b8cd", idle: "#8894b8" },
    "a selected row did not lift its dim text and idle pixel to the bar",
  );
  assert.equal(themed.editorGround, "rgb(40, 42, 54)");
  assert.equal(themed.inserted, "rgba(155, 185, 85, 0.2)");
  assert.equal(themed.removed, "rgba(255, 0, 0, 0.2)");
  assert.equal(themed.insertedWords, "rgba(80, 250, 123, 0.13)");
  assert.equal(themed.removedWords, "rgba(255, 85, 85, 0.31)");
  await themedSyntax(session, "after choosing the curated theme");
  await terminalReads(
    session,
    published.bg,
    terminalRed.theme,
    "in a terminal hidden at the change",
  );
  await waitUntil(async () => (await savedTheme(session)) === "dracula", waitMs, "not saved");
  await session.screenshot("theme-dracula");
  await session.page.setViewportSize({ width: 960, height: 600 });
  await session.screenshot("theme-dracula-small");
  await session.page.setViewportSize({ width: 1440, height: 900 });
  await runCommand(session, "theme-light");
  await settled(session, satellite, "after Use the light theme");
  await terminalReads(session, "#ffffff", terminalRed.satellite, "after Use the light theme");
  await waitUntil(
    async () => (await savedTheme(session)) === "light",
    waitMs,
    "Use the light theme was not saved",
  );
  await runCommand(session, "theme-dracula");
  await shows(session, published.bg, "after Use the Dracula theme");
  await waitUntil(
    async () => (await savedTheme(session)) === "dracula",
    waitMs,
    "Use the Dracula theme was not saved",
  );
  await session.relaunch();
  await visible(session, "title-settings", "after the relaunch");
  const relaunched = await shows(session, published.bg, "after the relaunch");
  assert.equal(relaunched.editorGround, "rgb(40, 42, 54)");
  await themedSyntax(session, "after the relaunch");
  await openSettings(session);
  assert.equal(await session.page.getByTestId("settings-theme").inputValue(), "dracula");
  await session.page.getByTestId("settings-theme").selectOption({ label: "Light" });
  await settled(session, satellite, "after choosing Light again");
}
