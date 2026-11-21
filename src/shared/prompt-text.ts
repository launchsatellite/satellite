import { keptJoins, visibleText } from "./visible-text.ts";

const promptTextLimit = 800;
const readLimit = promptTextLimit * 16;

const lineBreaks = /\r\n|[\r\n\t\u{2028}\u{2029}]/gu;
const hidden = new RegExp(
  `(?!${keptJoins})[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Zl}\\p{Zp}\\u{e0100}-\\u{e01ef}]`,
  "gu",
);

function withoutHidden(text: string): string {
  return text.replace(hidden, "");
}

export function holdsHiddenText(text: string): boolean {
  return text.search(hidden) !== -1;
}

export function holdsRevealedText(text: string): boolean {
  return visibleText(text) !== text;
}

export function promptText(raw: string): string {
  const clean = withoutHidden(raw.slice(0, readLimit).replace(lineBreaks, " "));
  return withoutHidden(clean.slice(0, promptTextLimit));
}
