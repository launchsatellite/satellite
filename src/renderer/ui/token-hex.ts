const sixDigitHex = /^#[0-9a-f]{6}$/;

function readColour(paint: CanvasRenderingContext2D, sentinel: string, value: string): string {
  paint.fillStyle = sentinel;
  paint.fillStyle = value;
  return paint.fillStyle;
}

export function tokenHexReader(): (name: string) => string {
  const styles = getComputedStyle(document.documentElement);
  const paint = document.createElement("canvas").getContext("2d");
  if (paint === null) throw new Error("A canvas is needed to read the theme colours");
  return (name) => {
    const value = styles.getPropertyValue(`--${name}`).trim();
    const hex = readColour(paint, "#000000", value);
    const valid = hex === readColour(paint, "#ffffff", value) && sixDigitHex.test(hex);
    if (!valid) throw new Error(`The theme token --${name} is not an opaque colour`);
    return hex;
  };
}
