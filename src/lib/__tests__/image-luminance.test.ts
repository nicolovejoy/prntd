import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { meanLuminance } from "@/lib/image-luminance";

/** A w×h PNG where every pixel is `rgba`. */
async function solid(rgba: [number, number, number, number], w = 8, h = 8): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: rgba[0], g: rgba[1], b: rgba[2], alpha: rgba[3] / 255 } },
  })
    .png()
    .toBuffer();
}

/** Left half `left`, right half `right` (both opaque unless alpha says otherwise). */
async function halves(
  left: [number, number, number, number],
  right: [number, number, number, number]
): Promise<Buffer> {
  const base = await solid(left, 8, 8);
  const overlay = await solid(right, 4, 8);
  return sharp(base).composite([{ input: overlay, left: 4, top: 0 }]).png().toBuffer();
}

describe("meanLuminance (#139)", () => {
  it("is 1 for opaque white and 0 for opaque black", async () => {
    expect(await meanLuminance(await solid([255, 255, 255, 255]))).toBeCloseTo(1, 3);
    expect(await meanLuminance(await solid([0, 0, 0, 255]))).toBeCloseTo(0, 3);
  });

  it("ignores transparent pixels: white artwork on a clear ground is 1", async () => {
    const png = await halves([0, 0, 0, 0], [255, 255, 255, 255]);
    expect(await meanLuminance(png)).toBeCloseTo(1, 3);
  });

  it("averages over the opaque pixels only: half white, half black is 0.5", async () => {
    const png = await halves([0, 0, 0, 255], [255, 255, 255, 255]);
    expect(await meanLuminance(png)).toBeCloseTo(0.5, 2);
  });

  it("is null for a fully transparent image (no opaque pixel)", async () => {
    expect(await meanLuminance(await solid([255, 255, 255, 0]))).toBeNull();
  });

  it("treats alpha 128 as transparent and 129 as opaque", async () => {
    expect(await meanLuminance(await solid([255, 255, 255, 128]))).toBeNull();
    expect(await meanLuminance(await solid([255, 255, 255, 129]))).toBeCloseTo(1, 3);
  });

  it("is null, not a throw, for bytes that are not an image", async () => {
    expect(await meanLuminance(Buffer.from([1, 2, 3]))).toBeNull();
    expect(await meanLuminance(Buffer.alloc(0))).toBeNull();
  });

  it("uses linearised sRGB: mid-grey #808080 is about 0.216, not 0.5", async () => {
    expect(await meanLuminance(await solid([128, 128, 128, 255]))).toBeCloseTo(0.216, 2);
  });
});
