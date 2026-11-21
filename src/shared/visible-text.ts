const joinedScript =
  "\\p{sc=Arabic}\\p{sc=Devanagari}\\p{sc=Bengali}\\p{sc=Gurmukhi}\\p{sc=Gujarati}\\p{sc=Oriya}\\p{sc=Tamil}\\p{sc=Telugu}\\p{sc=Kannada}\\p{sc=Malayalam}\\p{sc=Sinhala}";
const emojiJoin =
  "(?<=\\p{Extended_Pictographic}(?:\\u{fe0f}|\\p{Emoji_Modifier})?)\\u{200d}\\p{Extended_Pictographic}";
const emojiStyle = "(?<=\\p{Extended_Pictographic})\\u{fe0f}";
const scriptLetter = `(?=[\\p{L}\\p{M}])[${joinedScript}]`;
const scriptJoin = `(?<=${scriptLetter})[\\u{200c}\\u{200d}]${scriptLetter}`;
const blankCharacters =
  "\\u{180b}-\\u{180f}\\u{fe00}-\\u{fe0f}\\u{115f}\\u{3164}\\u{1160}\\u{ffa0}\\u{2800}\\u{a0}\\u{1680}\\u{2000}-\\u{200a}\\u{202f}\\u{205f}\\u{3000}";
const hiddenCharacter = new RegExp(
  `(?!${emojiJoin}|${emojiStyle}|${scriptJoin})(?:[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Zl}\\p{Zp}\\u{e0100}-\\u{e01ef}${blankCharacters}]|\\u{34f})`,
  "gu",
);

function codePoint(character: string): string {
  const hex = (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
  return `[U+${hex}]`;
}

function lineCharacter(character: string): string {
  if (character === "\n" || character === "\t") return character;
  return character === "\r" ? "\u{240d}" : codePoint(character);
}

export const keptJoins = `${emojiJoin}|${scriptJoin}`;

export function visibleText(raw: string): string {
  return raw.replace(hiddenCharacter, codePoint);
}

export function visibleLines(raw: string): string {
  return raw.replace(hiddenCharacter, lineCharacter);
}
