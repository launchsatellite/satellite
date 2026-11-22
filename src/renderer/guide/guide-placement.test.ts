import { describe, expect, it } from "vitest";
import { bandOf, placeGuide, type Box } from "./guide-placement.ts";
import type { GuideSide } from "./guide-steps.ts";

const card = { width: 300, height: 198 };
const wide = { width: 1280, height: 640 };
const narrow = { width: 960, height: 600 };

function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

describe("placeGuide", () => {
  it("puts the ring 4 outside the control and the card 32 to its right with the tail 28 from the corner", () => {
    const anchor = { left: 210, top: 163.8, width: 24, height: 24 };
    expect(placeGuide(anchor, card, wide, "right")).toEqual({
      ring: { left: 206, top: 160, width: 32, height: 32 },
      card: { left: 266, top: 148 },
      tail: 28,
    });
  });

  it("puts the card to the left of Start Claude Code and under the tabs as the mock draws them", () => {
    const session = { left: 1023, top: 323.4, width: 132.9, height: 28 };
    expect(placeGuide(session, card, wide, "left")?.card).toEqual({ left: 691, top: 309 });
    const tabs = { left: 259, top: 51.5, width: 195.1, height: 26 };
    const placed = placeGuide(tabs, card, wide, "below");
    expect(placed?.card).toEqual({ left: 329, top: 110 });
    expect(placed?.tail).toBe(28);
  });

  it("takes a 28 pixel band that ends 2 under the inbox header", () => {
    const band = bandOf({ left: 9, top: 67, width: 231, height: 34 }, { height: 28, below: 2 });
    expect(band).toEqual({ left: 9, top: 75, width: 231, height: 28 });
    expect(placeGuide(band, { width: 300, height: 268 }, wide, "right")?.card).toEqual({
      left: 272,
      top: 61,
    });
  });

  it("keeps the card 8 inside the window and the tail on the control when the control sits low", () => {
    const anchor = { left: 160, top: 560, width: 24, height: 24 };
    const placed = placeGuide(anchor, card, narrow, "right");
    expect(placed?.card).toEqual({ left: 216, top: 394 });
    expect(placed?.tail).toBe(178);
  });

  it("shows no card when the tail could not reach the control", () => {
    expect(
      placeGuide({ left: 160, top: 572, width: 24, height: 24 }, card, narrow, "right"),
    ).toBeNull();
  });

  it("shows no card for a control with no size or one the window cuts off", () => {
    expect(
      placeGuide({ left: 160, top: 300, width: 0, height: 24 }, card, narrow, "right"),
    ).toBeNull();
    expect(
      placeGuide({ left: 160, top: -4, width: 24, height: 24 }, card, narrow, "right"),
    ).toBeNull();
  });

  it("shows no card when its side has no room", () => {
    expect(
      placeGuide({ left: 200, top: 300, width: 100, height: 28 }, card, narrow, "left"),
    ).toBeNull();
  });

  it("never lets the card cover the control", () => {
    const cases: [Box, GuideSide][] = [
      [{ left: 210, top: 163.8, width: 24, height: 24 }, "right"],
      [{ left: 1023, top: 323.4, width: 132.9, height: 28 }, "left"],
      [{ left: 259, top: 51.5, width: 195.1, height: 26 }, "below"],
    ];
    for (const [anchor, side] of cases) {
      const placed = placeGuide(anchor, card, wide, side);
      expect(placed).not.toBeNull();
      if (placed === null) continue;
      expect(intersects({ ...placed.card, ...card }, anchor)).toBe(false);
    }
  });
});
