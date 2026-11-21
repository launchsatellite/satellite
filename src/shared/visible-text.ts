export interface VisiblePart {
  text: string;
  revealed: boolean;
}

export interface RevealedRange {
  line: number;
  start: number;
  end: number;
}

const joinedScript =
  "\\p{sc=Arabic}\\p{sc=Devanagari}\\p{sc=Bengali}\\p{sc=Gurmukhi}\\p{sc=Gujarati}\\p{sc=Oriya}\\p{sc=Tamil}\\p{sc=Telugu}\\p{sc=Kannada}\\p{sc=Malayalam}\\p{sc=Sinhala}";
const emojiJoin =
  "(?<=\\p{Extended_Pictographic}(?:\\u{fe0f}|\\p{Emoji_Modifier})?)\\u{200d}\\p{Extended_Pictographic}";
const emojiStyle = "(?<=\\p{Extended_Pictographic})\\u{fe0f}";
const scriptLetter = `(?=[\\p{L}\\p{M}])[${joinedScript}]`;
const scriptJoin = `(?<=${scriptLetter})[\\u{200c}\\u{200d}]${scriptLetter}`;
const drawnAsNothing =
  "\\p{Cc}\\p{Cf}\\p{Cs}\\p{Zl}\\p{Zp}\\p{Zs}\\p{Default_Ignorable_Code_Point}\\u{2800}\\u{1cbb}\\u{1cbc}\\u{fffc}\\u{133fc}";
const shownAlike = "\\u{240d}";
const hiddenCharacter = new RegExp(
  `(?!${emojiJoin}|${emojiStyle}|${scriptJoin}| )[${drawnAsNothing}]`,
  "gu",
);
const hiddenInLines = new RegExp(
  `(?!${emojiJoin}|${emojiStyle}|${scriptJoin}| )[${drawnAsNothing}${shownAlike}]`,
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

export function visibleParts(raw: string): VisiblePart[] {
  const parts: VisiblePart[] = [];
  const add = (text: string, revealed: boolean) => {
    const previous = parts.at(-1);
    if (text === "") return;
    if (previous?.revealed === revealed) previous.text += text;
    else parts.push({ text, revealed });
  };
  let last = 0;
  for (const found of raw.matchAll(hiddenCharacter)) {
    add(raw.slice(last, found.index), false);
    add(codePoint(found[0]), true);
    last = found.index + found[0].length;
  }
  add(raw.slice(last), false);
  return parts;
}

export function revealLines(raw: string): { text: string; revealed: RevealedRange[] } {
  const pieces: string[] = [];
  const revealed: RevealedRange[] = [];
  let line = 1;
  let column = 1;
  let last = 0;
  const advance = (plain: string) => {
    const lastBreak = plain.lastIndexOf("\n");
    if (lastBreak === -1) {
      column += plain.length;
      return;
    }
    line += plain.split("\n").length - 1;
    column = plain.length - lastBreak;
  };
  for (const found of raw.matchAll(hiddenInLines)) {
    const plain = raw.slice(last, found.index);
    pieces.push(plain);
    advance(plain);
    const character = found[0];
    const shown = lineCharacter(character);
    pieces.push(shown);
    last = found.index + character.length;
    if (shown === character) {
      advance(shown);
      continue;
    }
    const previous = revealed.at(-1);
    if (previous?.line === line && previous.end === column) previous.end += shown.length;
    else revealed.push({ line, start: column, end: column + shown.length });
    column += shown.length;
  }
  pieces.push(raw.slice(last));
  return { text: pieces.join(""), revealed };
}
