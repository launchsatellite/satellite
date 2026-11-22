import { describe, expect, it } from "vitest";
import { gif, jpeg, png, webpExtended, webpLossless, webpLossy, ascii } from "./image.test-fixture.ts";
import { hasImageSignature, readImageHeader } from "./image-size.ts";

describe("readImageHeader", () => {
  it("reads the size of a PNG, a GIF, a JPEG and the three WebP kinds from crafted bytes", () => {
    expect(readImageHeader(png(640, 480))).toEqual({ type: "image/png", width: 640, height: 480 });
    expect(readImageHeader(gif(300, 200))).toEqual({ type: "image/gif", width: 300, height: 200 });
    expect(readImageHeader(jpeg(1024, 768))).toEqual({
      type: "image/jpeg",
      width: 1024,
      height: 768,
    });
    expect(readImageHeader(jpeg(50, 60, 0xc2))).toEqual({
      type: "image/jpeg",
      width: 50,
      height: 60,
    });
    expect(readImageHeader(webpExtended(4000, 3000))).toEqual({
      type: "image/webp",
      width: 4000,
      height: 3000,
    });
    expect(readImageHeader(webpLossy(1280, 720))).toEqual({
      type: "image/webp",
      width: 1280,
      height: 720,
    });
    expect(readImageHeader(webpLossless(16384, 99))).toEqual({
      type: "image/webp",
      width: 16384,
      height: 99,
    });
  });

  it("refuses a truncated header, a zero size and bytes that only start like an image", () => {
    const whole = [png(1, 1), gif(1, 1), jpeg(1, 1), webpExtended(1, 1), webpLossy(1, 1)];
    for (const bytes of whole) {
      expect(readImageHeader(bytes)).toBeDefined();
      expect(readImageHeader(bytes.subarray(0, 9))).toBeUndefined();
    }
    expect(readImageHeader(png(1, 1).subarray(0, 23))).toBeUndefined();
    expect(readImageHeader(webpLossless(1, 1).subarray(0, 24))).toBeUndefined();
    expect(readImageHeader(jpeg(1, 1).subarray(0, 20))).toBeUndefined();
    expect(readImageHeader(png(0, 5))).toBeUndefined();
    expect(readImageHeader(gif(5, 0))).toBeUndefined();
    expect(readImageHeader(jpeg(0, 5))).toBeUndefined();
    expect(readImageHeader(webpLossy(0, 5))).toBeUndefined();
    expect(readImageHeader(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0]))).toBeUndefined();
    expect(
      readImageHeader(Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPJUNK")])),
    ).toBeUndefined();
    expect(readImageHeader(Uint8Array.from([...ascii("GIF89a")]))).toBeUndefined();
    expect(
      readImageHeader(Uint8Array.from(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"))),
    ).toBeUndefined();
    expect(readImageHeader(new Uint8Array(0))).toBeUndefined();
  });
});

describe("readImageHeader against a size a decoder would not use", () => {
  it("takes the larger of a GIF's screen and its first frame", () => {
    expect(readImageHeader(gif(1, 1, [23_000, 23_000]))).toEqual({
      type: "image/gif",
      width: 23_000,
      height: 23_000,
    });
  });

  it("answers nothing for a GIF with no frame in its head", () => {
    expect(readImageHeader(gif(1, 1).subarray(0, 20))).toBeUndefined();
  });

  it("answers nothing for a JPEG with a marker it does not know before the frame", () => {
    const decoy = [0xff, 0xc0, 0x00, 0x0b, 8, 0, 1, 0, 1, 1, 1];
    const real = [0xff, 0xc0, 0x00, 0x0b, 8, 0x59, 0xd8, 0x59, 0xd8, 1, 1];
    const bytes = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0x00,
      0x00,
      0x15,
      ...real,
      ...new Array<number>(8).fill(0),
      ...decoy,
    ]);
    expect(readImageHeader(bytes)).toBeUndefined();
  });
});

describe("hasImageSignature", () => {
  it("tells a start that claims an image from plain bytes", () => {
    expect(hasImageSignature(png(1, 1).subarray(0, 8))).toBe(true);
    expect(hasImageSignature(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(hasImageSignature(webpLossy(1, 1))).toBe(true);
    expect(hasImageSignature(Uint8Array.from(ascii("hello world")))).toBe(false);
  });
});
