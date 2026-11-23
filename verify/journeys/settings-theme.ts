import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSession } from "../driver.ts";
import { gone, startClaude, visible, waitUntil } from "./conditions.ts";

interface Look {
  tokens: Record<string, string>;
  theme: string | null;
  editorGround: string;
  syntax: Record<string, string>;
  removedSyntax: Record<string, string>;
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
  working: "#bd93f9",
  signal: "#ffb86c",
  volt: "#50fa7b",
  lilac: "#8be9fd",
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
const terminalRed = { satellite: "#cc0000", theme: "#ff5555" };
const shotTolerance = 3;

async function look(session: AppSession): Promise<Look> {
  return session.page.evaluate((names) => {
    const root = getComputedStyle(document.documentElement);
    const diff = document.querySelector("[data-testid='diff']");
    const background = (selector: string) => {
      const found = diff?.querySelector(selector);
      return found === null || found === undefined ? "" : getComputedStyle(found).backgroundColor;
    };
    const colours = (spans: NodeListOf<Element> | undefined) => {
      const read: Record<string, string> = {};
      for (const span of spans ?? []) {
        const text = span.textContent.trim();
        const colour = getComputedStyle(span).color;
        const known = read[text];
        if (text === "") continue;
        if (known === undefined) read[text] = colour;
        else if (!known.split(" | ").includes(colour)) read[text] = `${known} | ${colour}`;
      }
      return read;
    };
    const syntax = colours(diff?.querySelectorAll(".view-line span span:not(.view-zones *)"));
    const removedSyntax = colours(diff?.querySelectorAll(".view-zones .view-line span span"));
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
      inserted: background(".line-insert"),
      removed: background(".line-delete"),
      insertedWords: background(".char-insert"),
      removedWords: background(".char-delete"),
    };
  }, tokenNames);
}

async function shotColours(session: AppSession, shot: Buffer): Promise<string[]> {
  return session.page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const paint = canvas.getContext("2d");
    if (paint === null) return [];
    paint.drawImage(bitmap, 0, 0);
    const { data } = paint.getImageData(0, 0, bitmap.width, bitmap.height);
    const counts = new Map<string, number>();
    for (let at = 0; at < data.length; at += 4) {
      const hex = `#${[data[at], data[at + 1], data[at + 2]]
        .map((channel) => (channel ?? 0).toString(16).padStart(2, "0"))
        .join("")}`;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .filter(([, count]) => count >= 40)
      .map(([hex]) => hex);
  }, shot.toString("base64"));
}

async function asShot(session: AppSession, colour: string): Promise<string> {
  await session.page.evaluate((fill) => {
    const swatch = document.createElement("div");
    swatch.dataset["testid"] = "verify-swatch";
    swatch.style.cssText = `position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;background:${fill}`;
    document.body.append(swatch);
  }, colour);
  const swatch = session.page.getByTestId("verify-swatch");
  const shot = await swatch.screenshot();
  await swatch.evaluate((element) => {
    element.remove();
  });
  return (await shotColours(session, shot))[0] ?? "";
}

function near(first: string, second: string): boolean {
  const channels = (hex: string) =>
    [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const [a, b] = [channels(first), channels(second)];
  return a.every((channel, at) => Math.abs(channel - (b[at] ?? -255)) <= shotTolerance);
}

async function terminalColours(session: AppSession): Promise<string[]> {
  return shotColours(session, await session.page.getByTestId("terminal").screenshot());
}

async function shows(session: AppSession, bg: string, when: string): Promise<Look> {
  let last: Look | undefined;
  await waitUntil(
    async () => {
      last = await look(session);
      return last.tokens["bg"] === bg && last.editorGround !== "" && last.inserted !== "";
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
      return (
        JSON.stringify({ ...last, removedSyntax: {} }) ===
        JSON.stringify({ ...expected, removedSyntax: {} })
      );
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

async function terminalReads(
  session: AppSession,
  ground: string,
  red: string,
  when: string,
): Promise<void> {
  const shotGround = await asShot(session, ground);
  const shotRed = await asShot(session, red);
  let last: string[] | undefined;
  await waitUntil(
    async () => {
      last = await terminalColours(session);
      const [first] = last;
      return (
        first !== undefined &&
        near(first, shotGround) &&
        last.some((colour) => near(colour, shotRed))
      );
    },
    waitMs,
    () =>
      `the terminal did not read ${ground} with ${red}, shot as ${shotGround} and ${shotRed}, ${when}, it read ${JSON.stringify(last)}`,
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
  await runCommand(session, "theme-dracula");
  await shows(session, published.bg, "after Use the Dracula theme");
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
