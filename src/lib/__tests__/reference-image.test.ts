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
});
