import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";

const getObjectByKey = vi.fn();
vi.mock("../r2", () => ({
  imageKeyFromUrl: (url: string) =>
    url.startsWith("https://r2/") ? url.slice("https://r2/".length) : null,
  getObjectByKey: (...args: unknown[]) => getObjectByKey(...args),
}));

import { loadBriefPhoto, BRIEF_PHOTO_READ_TIMEOUT_MS } from "../brief-photo";

async function noisePng(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("loadBriefPhoto", () => {
  beforeEach(() => {
    getObjectByKey.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns a JPEG within 1568 px that decodes, and reads with the short timeout", async () => {
    getObjectByKey.mockResolvedValue(await noisePng(3000, 2000));
    const photo = await loadBriefPhoto("https://r2/images/p.png");
    expect(photo?.mediaType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(photo!.data, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1568);
    expect(meta.width).toBe(1568);
    expect(getObjectByKey).toHaveBeenCalledWith(
      "images/p.png",
      BRIEF_PHOTO_READ_TIMEOUT_MS
    );
    expect(BRIEF_PHOTO_READ_TIMEOUT_MS).toBe(5_000);
  });

  it("stays under 5 MB as base64 for the largest stored upload of pure noise", async () => {
    // True noise does not compress: as PNG this is about 12 MB, so a PNG
    // passthrough or a dropped resize fails here.
    const png = await sharp(randomBytes(2048 * 2048 * 3), {
      raw: { width: 2048, height: 2048, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(png.length).toBeGreaterThan(5 * 1024 * 1024);
    getObjectByKey.mockResolvedValue(png);
    const photo = await loadBriefPhoto("https://r2/images/p.png");
    expect(photo!.data.length).toBeLessThan(5 * 1024 * 1024);
  });

  it("does not enlarge a small image", async () => {
    getObjectByKey.mockResolvedValue(await noisePng(200, 100));
    const photo = await loadBriefPhoto("https://r2/images/p.png");
    const meta = await sharp(Buffer.from(photo!.data, "base64")).metadata();
    expect(meta.width).toBe(200);
  });

  it("returns null when the object is missing", async () => {
    getObjectByKey.mockResolvedValue(null);
    expect(await loadBriefPhoto("https://r2/images/p.png")).toBeNull();
  });

  it("returns null when the read times out", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    getObjectByKey.mockRejectedValue(err);
    expect(await loadBriefPhoto("https://r2/images/p.png")).toBeNull();
  });

  it("returns null for bytes that are not an image", async () => {
    getObjectByKey.mockResolvedValue(Buffer.from("not an image"));
    expect(await loadBriefPhoto("https://r2/images/p.png")).toBeNull();
  });

  it("returns null for a URL outside the bucket, without reading", async () => {
    expect(await loadBriefPhoto("https://elsewhere/x.png")).toBeNull();
    expect(getObjectByKey).not.toHaveBeenCalled();
  });
});
