const promptTextLimit = 800;
const readLimit = promptTextLimit * 16;

const lineBreaks = /\r\n|[\r\n\t\u{2028}\u{2029}]/gu;
const joinedScript =
  "\\p{sc=Arabic}\\p{sc=Devanagari}\\p{sc=Bengali}\\p{sc=Gurmukhi}\\p{sc=Gujarati}\\p{sc=Oriya}\\p{sc=Tamil}\\p{sc=Telugu}\\p{sc=Kannada}\\p{sc=Malayalam}\\p{sc=Sinhala}";
const emojiJoin =
  "(?<=\\p{Extended_Pictographic}(?:\\u{fe0f}|\\p{Emoji_Modifier})?)\\u{200d}\\p{Extended_Pictographic}";
const scriptLetter = `(?=[\\p{L}\\p{M}])[${joinedScript}]`;
const scriptJoin = `(?<=${scriptLetter})[\\u{200c}\\u{200d}]${scriptLetter}`;
const hidden = new RegExp(
  `(?!${emojiJoin}|${scriptJoin})[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Zl}\\p{Zp}\\u{e0100}-\\u{e01ef}]`,
  "gu",
);

function withoutHidden(text: string): string {
  return text.replace(hidden, "");
}

export function holdsHiddenText(text: string): boolean {
  return text.search(hidden) !== -1;
}

export function promptText(raw: string): string {
  const clean = withoutHidden(raw.slice(0, readLimit).replace(lineBreaks, " "));
  return withoutHidden(clean.slice(0, promptTextLimit));
}
