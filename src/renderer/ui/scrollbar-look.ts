export const scrollbarLook = { gutter: 10, thumb: 6, rest: 0.2, hover: 0.35, drag: 0.5 } as const;

const alpha = (strength: number) =>
  Math.round(strength * 255)
    .toString(16)
    .padStart(2, "0");

export function thumbColours(fg: string): { rest: string; hover: string; drag: string } {
  const opaque = fg.slice(0, 7);
  return {
    rest: opaque + alpha(scrollbarLook.rest),
    hover: opaque + alpha(scrollbarLook.hover),
    drag: opaque + alpha(scrollbarLook.drag),
  };
}

export function monacoScrollbarColours(fg: string): Record<string, string> {
  const { rest, hover, drag } = thumbColours(fg);
  return {
    "scrollbarSlider.background": rest,
    "scrollbarSlider.hoverBackground": hover,
    "scrollbarSlider.activeBackground": drag,
  };
}
