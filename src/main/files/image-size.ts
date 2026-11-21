import type { ImageType } from "../../shared/bridge-contract.ts";

export interface ImageKind {
  type: ImageType;
  width: number;
  height: number;
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const jpegSignature = [0xff, 0xd8, 0xff];
const noLengthMarkers = new Set([0x01, 0xd8, ...Array.from({ length: 8 }, (_, at) => 0xd0 + at)]);
const segmentMarkers = new Set([
  ...Array.from({ length: 16 }, (_, at) => 0xc0 + at),
  ...Array.from({ length: 5 }, (_, at) => 0xdb + at),
  ...Array.from({ length: 16 }, (_, at) => 0xe0 + at),
  0xfe,
]);
const notFrameMarkers = new Set([0xc4, 0xc8, 0xcc]);
const ascii = new TextDecoder("latin1");

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  return bytes.length >= at + prefix.length && prefix.every((byte, i) => bytes[at + i] === byte);
}

function text(bytes: Uint8Array, from: number, to: number): string {
  return ascii.decode(bytes.subarray(from, to));
}

function byteAt(bytes: Uint8Array, at: number): number {
  return bytes[at] ?? 0;
}

function big16(bytes: Uint8Array, at: number): number {
  return byteAt(bytes, at) * 256 + byteAt(bytes, at + 1);
}

function little16(bytes: Uint8Array, at: number): number {
  return byteAt(bytes, at) + byteAt(bytes, at + 1) * 256;
}

function little24(bytes: Uint8Array, at: number): number {
  return little16(bytes, at) + byteAt(bytes, at + 2) * 65536;
}

function sized(type: ImageType, width: number, height: number): ImageKind | undefined {
  return width > 0 && height > 0 ? { type, width, height } : undefined;
}

function pngSize(bytes: Uint8Array): ImageKind | undefined {
  if (bytes.length < 24 || text(bytes, 12, 16) !== "IHDR") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return sized("image/png", view.getUint32(16), view.getUint32(20));
}

function gifSize(bytes: Uint8Array): ImageKind | undefined {
  if (bytes.length < 13) return undefined;
  let width = little16(bytes, 6);
  let height = little16(bytes, 8);
  const packed = byteAt(bytes, 10);
  let at = 13 + ((packed & 0x80) === 0 ? 0 : 3 * 2 ** ((packed & 7) + 1));
  while (at < bytes.length) {
    const block = byteAt(bytes, at);
    if (block === 0x2c) {
      if (at + 10 > bytes.length) return undefined;
      width = Math.max(width, little16(bytes, at + 1) + little16(bytes, at + 5));
      height = Math.max(height, little16(bytes, at + 3) + little16(bytes, at + 7));
      return sized("image/gif", width, height);
    }
    if (block !== 0x21) return undefined;
    at += 2;
    for (let size = byteAt(bytes, at); size !== 0; size = byteAt(bytes, at)) {
      if (at >= bytes.length) return undefined;
      at += 1 + size;
    }
    at += 1;
  }
  return undefined;
}

function webpSize(bytes: Uint8Array): ImageKind | undefined {
  const chunk = text(bytes, 12, 16);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return sized("image/webp", little24(bytes, 24) + 1, little24(bytes, 27) + 1);
  }
  if (chunk === "VP8 " && bytes.length >= 30 && (byteAt(bytes, 20) & 1) === 0) {
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return undefined;
    return sized("image/webp", little16(bytes, 26) & 0x3fff, little16(bytes, 28) & 0x3fff);
  }
  if (chunk === "VP8L" && bytes.length >= 25 && byteAt(bytes, 20) === 0x2f) {
    const bits = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(21, true);
    return sized("image/webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return undefined;
}

function jpegSize(bytes: Uint8Array): ImageKind | undefined {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (byteAt(bytes, at) !== 0xff) return undefined;
    const marker = byteAt(bytes, at + 1);
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (noLengthMarkers.has(marker)) {
      at += 2;
      continue;
    }
    if (!segmentMarkers.has(marker)) return undefined;
    const length = big16(bytes, at + 2);
    if (length < 2) return undefined;
    if (marker >= 0xc0 && marker <= 0xcf && !notFrameMarkers.has(marker)) {
      if (at + 9 > bytes.length) return undefined;
      return sized("image/jpeg", big16(bytes, at + 7), big16(bytes, at + 5));
    }
    at += 2 + length;
  }
  return undefined;
}

export function hasImageSignature(bytes: Uint8Array): boolean {
  const head = text(bytes, 0, 6);
  return (
    startsWith(bytes, pngSignature) ||
    startsWith(bytes, jpegSignature) ||
    head === "GIF87a" ||
    head === "GIF89a" ||
    (text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 12) === "WEBP")
  );
}

export function readImageHeader(bytes: Uint8Array): ImageKind | undefined {
  if (startsWith(bytes, pngSignature)) return pngSize(bytes);
  if (startsWith(bytes, jpegSignature)) return jpegSize(bytes);
  const head = text(bytes, 0, 6);
  if (head === "GIF87a" || head === "GIF89a") return gifSize(bytes);
  if (text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 12) === "WEBP") return webpSize(bytes);
  return undefined;
}
