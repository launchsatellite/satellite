import type { ThemeChoice } from "../../shared/bridge-contract.ts";
import { curatedLook } from "../../shared/themes/curated-themes.ts";
import {
  appTokens,
  pairedGrounds,
  pixelTokens,
  textTokens,
  type ThemeLook,
} from "../../shared/themes/theme-look.ts";

const themeEvent = "satellite:theme";
const extraTokens = ["shadow", "selection"] as const;
const pairedNames = pairedGrounds.flatMap((ground) =>
  [...textTokens, ...pixelTokens].map((token) => ({ ground, token, name: `--${ground}-${token}` })),
);

const schemeWaitMs = 1000;

let shown: ThemeLook | undefined;
let wanted: ThemeChoice | undefined;

export function shownLook(): ThemeLook | undefined {
  return shown;
}

function schemeReached(choice: ThemeChoice): boolean {
  if (choice !== "light" && choice !== "dark") return true;
  return matchMedia("(prefers-color-scheme: dark)").matches === (choice === "dark");
}

function showOnceSchemeTurns(choice: ThemeChoice): void {
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const show = () => {
    scheme.removeEventListener("change", show);
    if (wanted === choice) paint(choice);
  };
  scheme.addEventListener("change", show);
  setTimeout(show, schemeWaitMs);
}

export function showTheme(choice: ThemeChoice): void {
  if (choice === wanted) return;
  wanted = choice;
  if (curatedLook(choice) === undefined && shown !== undefined && !schemeReached(choice)) {
    showOnceSchemeTurns(choice);
    return;
  }
  paint(choice);
}

function paint(choice: ThemeChoice): void {
  const look = curatedLook(choice);
  if (look === shown) return;
  shown = look;
  const root = document.documentElement;
  if (look === undefined) {
    for (const token of [...appTokens, ...extraTokens]) root.style.removeProperty(`--${token}`);
    for (const { name } of pairedNames) root.style.removeProperty(name);
    root.style.removeProperty("color-scheme");
    delete root.dataset["theme"];
  } else {
    for (const token of appTokens) root.style.setProperty(`--${token}`, look.tokens[token]);
    for (const { ground, token, name } of pairedNames)
      root.style.setProperty(name, look.paired[ground][token]);
    root.style.setProperty("--shadow", look.shadow);
    root.style.setProperty("--selection", look.selection);
    root.style.setProperty("color-scheme", look.type);
    root.dataset["theme"] = choice;
  }
  window.dispatchEvent(new Event(themeEvent));
}

export function onThemeChange(listener: () => void): () => void {
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", listener);
  window.addEventListener(themeEvent, listener);
  return () => {
    scheme.removeEventListener("change", listener);
    window.removeEventListener(themeEvent, listener);
  };
}
