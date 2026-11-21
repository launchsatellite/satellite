export const noticeNameLimit = 32;

const outsideName = /[^\p{L}\p{M}\p{N} ._+()-]|\p{Default_Ignorable_Code_Point}/gu;
const spaces = / +/g;
const leadingMarks = /^\p{M}+/u;
const letterOrDigit = /[\p{L}\p{N}]/u;
const rawLimit = 1024;
const clusters = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function cutToLimit(text: string, limit: number): string {
  let cut = "";
  let points = 0;
  for (const { segment } of clusters.segment(text)) {
    points += Array.from(segment).length;
    if (points > limit) break;
    cut += segment;
  }
  return cut;
}

export function noticeName(raw: string, fallback: string, limit = noticeNameLimit): string {
  const spaced = raw
    .slice(0, rawLimit)
    .replace(outsideName, " ")
    .replace(spaces, " ")
    .trim()
    .replace(leadingMarks, "")
    .trim();
  const cut = cutToLimit(spaced, limit).trim();
  return letterOrDigit.test(cut) ? cut : fallback;
}
