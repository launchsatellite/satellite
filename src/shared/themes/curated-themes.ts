import dracula from "shiki/themes/dracula.mjs";
import { themeLook, type StateKeys, type ThemeLook } from "./theme-look.ts";

export interface CuratedTheme {
  id: string;
  name: string;
  credit: string;
  site: string;
  licence: string;
  theme: unknown;
  states: StateKeys;
}

export const curatedThemes = [
  {
    id: "dracula",
    name: "Dracula",
    credit: "Dracula is made by the Dracula Theme team and shared under the MIT licence.",
    site: "https://draculatheme.com/",
    licence: [
      "The MIT License (MIT)",
      "Copyright (c) 2016 Dracula Theme",
      'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
      "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.",
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
    ].join("\n\n"),
    theme: dracula,
    states: {
      working: "terminal.ansiBrightCyan",
      needsYou: "list.warningForeground",
      ready: "terminal.ansiGreen",
      done: "terminal.ansiBlue",
      idle: "terminal.ansiBrightBlack",
      danger: "errorForeground",
    },
  },
] as const satisfies readonly CuratedTheme[];

export type CuratedThemeId = (typeof curatedThemes)[number]["id"];

export const curatedThemeIds: CuratedThemeId[] = curatedThemes.map(({ id }) => id);

export function curatedTheme(id: string): (typeof curatedThemes)[number] | undefined {
  return curatedThemes.find((entry) => entry.id === id);
}

const looks = new Map<string, ThemeLook | undefined>();

export function curatedLook(id: string): ThemeLook | undefined {
  const entry = curatedTheme(id);
  if (entry === undefined) return undefined;
  if (!looks.has(id)) looks.set(id, themeLook(entry.theme, entry.states));
  return looks.get(id);
}

export function themeSource(choice: string): "system" | "light" | "dark" {
  if (choice === "system" || choice === "light" || choice === "dark") return choice;
  return curatedLook(choice)?.type ?? "dark";
}
