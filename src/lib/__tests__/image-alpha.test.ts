import { describe, it, expect } from "vitest";
import { pngHasAlpha } from "../image-alpha";

/**
 * Build a minimal PNG prefix: signature + IHDR with the given colour type,
 * followed by named chunks (length/data/CRC are zero-filled — pngHasAlpha
 * only scans for the type markers).
 */
function png(colourType: number, chunks: string[] = ["IDAT"]): Uint8Array {
  const bytes: number[] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length = 13
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x04, 0x00, // width
    0x00, 0x00, 0x04, 0x00, // height
    0x08, // bit depth
    colourType, // byte 25
    0x00, 0x00, 0x00, // compression, filter, interlace
    0x00, 0x00, 0x00, 0x00, // CRC
  ];
  for (const name of chunks) {
    bytes.push(0x00, 0x00, 0x00, 0x00); // length
    for (const c of name) bytes.push(c.charCodeAt(0));
    bytes.push(0x00, 0x00, 0x00, 0x00); // CRC
  }
  return new Uint8Array(bytes);
}

describe("pngHasAlpha", () => {
  it("RGBA (colour type 6) has alpha", () => {
    expect(pngHasAlpha(png(6))).toBe(true);
  });

  it("gray+alpha (colour type 4) has alpha", () => {
    expect(pngHasAlpha(png(4))).toBe(true);
  });

  it("RGB (colour type 2) reaching IDAT without tRNS has no alpha", () => {
    expect(pngHasAlpha(png(2))).toBe(false);
  });

  it("grayscale (colour type 0) without tRNS has no alpha", () => {
    expect(pngHasAlpha(png(0))).toBe(false);
  });

  it("palette (colour type 3) without tRNS has no alpha", () => {
    expect(pngHasAlpha(png(3, ["PLTE", "IDAT"]))).toBe(false);
  });

  it("palette with a tRNS chunk before IDAT has alpha", () => {
    expect(pngHasAlpha(png(3, ["PLTE", "tRNS", "IDAT"]))).toBe(true);
  });

  it("RGB with a tRNS chunk has alpha", () => {
    expect(pngHasAlpha(png(2, ["tRNS", "IDAT"]))).toBe(true);
  });

  it("is inconclusive (null) when truncated before IDAT", () => {
    expect(pngHasAlpha(png(2, []))).toBeNull();
  });

  it("non-PNG bytes are null", () => {
    expect(pngHasAlpha(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it("too-short input is null", () => {
    expect(pngHasAlpha(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});
