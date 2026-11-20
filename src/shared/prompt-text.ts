export const promptTextLimit = 4000;

const lineBreaks = /\r\n|[\r\n\t\u{2028}\u{2029}]/gu;
const hidden =
  /(?!(?<=\p{Extended_Pictographic}(?:\u{fe0f}|\p{Emoji_Modifier})?)\u{200d}\p{Extended_Pictographic})[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u{e0100}-\u{e01ef}]/gu;

function withoutHidden(text: string): string {
  return text.replace(hidden, "");
}

export function holdsHiddenText(text: string): boolean {
  return text.search(hidden) !== -1;
}

export function promptText(raw: string): string {
  const clean = withoutHidden(raw.replace(lineBreaks, " "));
  return withoutHidden(clean.slice(0, promptTextLimit));
}
