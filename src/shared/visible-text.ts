const hiddenCharacter = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}]/gu;

function codePoint(character: string): string {
  const hex = (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
  return `[U+${hex}]`;
}

export function visibleText(raw: string): string {
  return raw.replace(hiddenCharacter, codePoint);
}
