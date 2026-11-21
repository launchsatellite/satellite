export function ascii(text: string): number[] {
  return Array.from(text, (letter) => letter.charCodeAt(0));
}

function big32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function little(value: number, bytes: number): number[] {
  return Array.from({ length: bytes }, (_, at) => Math.floor(value / 256 ** at) % 256);
}

export function png(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89,
    ...ascii("PNG\r\n"),
    0x1a,
    0x0a,
    ...big32(13),
    ...ascii("IHDR"),
    ...big32(width),
    ...big32(height),
    8,
    6,
    0,
    0,
    0,
  ]);
}

export function gif(width: number, height: number): Uint8Array {
  return Uint8Array.from([...ascii("GIF89a"), ...little(width, 2), ...little(height, 2), 0, 0, 0]);
}

export function jpeg(width: number, height: number, marker = 0xc0): Uint8Array {
  const app = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
  const frame = [0xff, marker, 0x00, 0x0b, 8, ...big32(height * 65536 + width).slice(0, 4), 1, 1];
  const table = [0xff, 0xc4, 0x00, 0x04, 0, 0];
  return Uint8Array.from([0xff, 0xd8, ...app, ...table, ...frame, 0, 0, 0]);
}

function riff(chunk: number[]): Uint8Array {
  return Uint8Array.from([
    ...ascii("RIFF"),
    ...little(chunk.length + 4, 4),
    ...ascii("WEBP"),
    ...chunk,
  ]);
}

export function webpExtended(width: number, height: number): Uint8Array {
  return riff([
    ...ascii("VP8X"),
    ...little(10, 4),
    0,
    0,
    0,
    0,
    ...little(width - 1, 3),
    ...little(height - 1, 3),
  ]);
}

export function webpLossy(width: number, height: number): Uint8Array {
  return riff([
    ...ascii("VP8 "),
    ...little(10, 4),
    0x10,
    0x02,
    0x00,
    0x9d,
    0x01,
    0x2a,
    ...little(width, 2),
    ...little(height, 2),
  ]);
}

export function webpLossless(width: number, height: number): Uint8Array {
  const bits = width - 1 + (height - 1) * 16384;
  return riff([...ascii("VP8L"), ...little(5, 4), 0x2f, ...little(bits, 4)]);
}
