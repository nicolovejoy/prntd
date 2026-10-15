import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  normalizeReferenceImage,
  REFERENCE_IMAGE_MAX_BYTES,
  REFERENCE_IMAGE_MAX_SIDE,
} from "@/lib/reference-image";

async function meta(buf: Buffer) {
  const m = await sharp(buf).metadata();
  return { format: m.format, width: m.width, height: m.height };
}

function raw(w: number, h: number) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 20, b: 20 } } });
}

describe("normalizeReferenceImage", () => {
  it("a PNG under the cap comes back as a PNG", async () => {
    const r = await normalizeReferenceImage(await raw(4, 4).png().toBuffer());
    expect(r.ok).toBe(true);
    if (r.ok) expect(await meta(r.png)).toEqual({ format: "png", width: 4, height: 4 });
  });

  it("a JPEG is converted to PNG", async () => {
    const r = await normalizeReferenceImage(await raw(8, 8).jpeg().toBuffer());
    expect(r.ok).toBe(true);
    if (r.ok) expect((await meta(r.png)).format).toBe("png");
  });

  it("the longest side is resized to 2048 and the aspect kept", async () => {
    expect(REFERENCE_IMAGE_MAX_SIDE).toBe(2048);
    const r = await normalizeReferenceImage(await raw(4000, 1000).jpeg().toBuffer());
    expect(r.ok).toBe(true);
    if (r.ok) expect(await meta(r.png)).toMatchObject({ width: 2048, height: 512 });
  });

  it("a smaller image is never enlarged", async () => {
    const r = await normalizeReferenceImage(await raw(100, 50).png().toBuffer());
    expect(r.ok).toBe(true);
    if (r.ok) expect(await meta(r.png)).toMatchObject({ width: 100, height: 50 });
  });

  it("EXIF rotation is applied", async () => {
    const jpeg = await raw(2, 1).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await normalizeReferenceImage(jpeg);
    expect(r.ok).toBe(true);
    if (r.ok) expect(await meta(r.png)).toMatchObject({ width: 1, height: 2 });
  });

  it("bytes over REFERENCE_IMAGE_MAX_BYTES give too_large", async () => {
    const r = await normalizeReferenceImage(Buffer.alloc(REFERENCE_IMAGE_MAX_BYTES + 1));
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });

  it("bytes that do not decode give unsupported", async () => {
    expect(await normalizeReferenceImage(Buffer.from([1, 2, 3]))).toEqual({ ok: false, reason: "unsupported" });
  });

  it("an empty buffer gives unsupported", async () => {
    expect(await normalizeReferenceImage(Buffer.alloc(0))).toEqual({ ok: false, reason: "unsupported" });
  });

  it("a GIF is accepted as its first frame (pinned)", async () => {
    const gif = await raw(6, 6).gif().toBuffer();
    const r = await normalizeReferenceImage(gif);
    expect(r.ok).toBe(true);
    if (r.ok) expect(await meta(r.png)).toMatchObject({ format: "png", width: 6, height: 6 });
  });

  it("a raster over the pixel limit is refused as unsupported without decoding it", async () => {
    // 8000x8000 flat colour: 64 MP declared, a small file once compressed.
    const big = await sharp({
      create: { width: 8000, height: 8000, channels: 3, background: { r: 0, g: 0, b: 0 } },
      limitInputPixels: false,
    })
      .png({ compressionLevel: 1 })
      .toBuffer();
    expect(big.length).toBeLessThan(REFERENCE_IMAGE_MAX_BYTES);
    expect(await normalizeReferenceImage(big)).toEqual({ ok: false, reason: "unsupported" });
  }, 30_000);

  it("a 12 MP photo still passes", async () => {
    const photo = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .toBuffer();
    const r = await normalizeReferenceImage(photo);
    expect(r.ok).toBe(true);
  }, 30_000);

  it("formats other than png, jpeg, webp and gif are refused (SVG, TIFF)", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    expect(await normalizeReferenceImage(svg)).toEqual({ ok: false, reason: "unsupported" });
    const tiff = await raw(4, 4).tiff().toBuffer();
    expect(await normalizeReferenceImage(tiff)).toEqual({ ok: false, reason: "unsupported" });
  });

  it("webp is accepted", async () => {
    const r = await normalizeReferenceImage(await raw(4, 4).webp().toBuffer());
    expect(r.ok).toBe(true);
  });
});
