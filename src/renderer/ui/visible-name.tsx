import { visibleParts, visibleText } from "../../shared/visible-text.ts";
import { lookAlikeColumns } from "../diff/look-alikes.ts";

function MarkedText({ text }: { text: string }) {
  const pieces: { text: string; lookAlike: boolean }[] = [];
  let last = 0;
  for (const { start, end } of lookAlikeColumns(text)) {
    pieces.push({ text: text.slice(last, start - 1), lookAlike: false });
    pieces.push({ text: text.slice(start - 1, end - 1), lookAlike: true });
    last = end - 1;
  }
  pieces.push({ text: text.slice(last), lookAlike: false });
  return pieces.map((piece, index) =>
    piece.lookAlike ? (
      <span key={index} className="look-alike">
        {piece.text}
      </span>
    ) : (
      piece.text
    ),
  );
}

export function VisibleName({ text }: { text: string }) {
  return visibleParts(text).map((part, index) =>
    part.revealed ? (
      <span key={index} className="revealed">
        {part.text}
      </span>
    ) : (
      <MarkedText key={index} text={part.text} />
    ),
  );
}

export function visibleLabel(text: string): string {
  const shown = visibleText(text);
  return lookAlikeColumns(shown).length === 0 ? shown : `${shown} (look-alike letters)`;
}
