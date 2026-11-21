import type { GuideSide } from "./guide-steps.ts";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Placement {
  ring: Box;
  card: { left: number; top: number };
  tail: number;
}
interface Size {
  width: number;
  height: number;
}

const guideGeometry = { ring: 4, gap: 32, aim: 28, margin: 8, tailInset: 16 };

function isInside(box: Box, viewport: Size): boolean {
  return (
    box.left >= 0 &&
    box.top >= 0 &&
    box.left + box.width <= viewport.width &&
    box.top + box.height <= viewport.height
  );
}

function alongControl(
  middle: number,
  cardSize: number,
  windowSize: number,
): { start: number; tail: number } | null {
  const { aim, margin, tailInset } = guideGeometry;
  const highest = windowSize - cardSize - margin;
  if (highest < margin) return null;
  const start = Math.min(Math.max(middle - aim, margin), highest);
  const tail = middle - start;
  return tail < tailInset || tail > cardSize - tailInset ? null : { start, tail };
}

export function bandOf(row: Box, band: { height: number; below: number } | undefined): Box {
  if (band === undefined) return row;
  return {
    left: row.left,
    width: row.width,
    height: band.height,
    top: row.top + row.height + band.below - band.height,
  };
}

export function placeGuide(
  anchor: Box,
  card: Size,
  viewport: Size,
  side: GuideSide,
): Placement | null {
  if (anchor.width <= 0 || anchor.height <= 0 || !isInside(anchor, viewport)) return null;
  const { ring, gap, margin } = guideGeometry;
  const across = side === "below";
  const along = across
    ? alongControl(anchor.left + anchor.width / 2, card.width, viewport.width)
    : alongControl(anchor.top + anchor.height / 2, card.height, viewport.height);
  if (along === null) return null;
  const main = {
    right: anchor.left + anchor.width + gap,
    left: anchor.left - gap - card.width,
    below: anchor.top + anchor.height + gap,
  }[side];
  const mainEnd = main + (across ? card.height : card.width);
  const mainLimit = across ? viewport.height : viewport.width;
  if (main < margin || mainEnd > mainLimit - margin) return null;
  return {
    ring: {
      left: Math.round(anchor.left - ring),
      top: Math.round(anchor.top - ring),
      width: Math.round(anchor.width + ring * 2),
      height: Math.round(anchor.height + ring * 2),
    },
    card: across
      ? { left: Math.round(along.start), top: Math.round(main) }
      : { left: Math.round(main), top: Math.round(along.start) },
    tail: Math.round(along.tail),
  };
}
