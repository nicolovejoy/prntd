import { describe, it, expect, vi, afterEach } from "vitest";
import { downscaleForUpload } from "@/lib/client-image-downscale";

const MAX_BYTES = 3 * 1024 * 1024;

function file(name: string, type: string, size: number) {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe("downscaleForUpload", () => {
  it("returns the original when createImageBitmap or canvas is not available", async () => {
    const f = file("a.jpg", "image/jpeg", MAX_BYTES + 1);
    expect(await downscaleForUpload(f)).toBe(f);
  });

  it("returns the original when the bitmap throws", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("bad"); }));
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({}) }) });
    const f = file("a.jpg", "image/jpeg", MAX_BYTES + 1);
    expect(await downscaleForUpload(f)).toBe(f);
  });

  function stubCanvas(width: number, height: number, outBytes = 1000) {
    const close = vi.fn();
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const canvas: Record<string, unknown> = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, fillRect, fillStyle: "" }),
      toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => {
        canvas.requested = { type, q };
        cb(new Blob(["y".repeat(outBytes)], { type }));
      },
    };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close })));
    vi.stubGlobal("document", { createElement: () => canvas });
    return { canvas, close, drawImage, fillRect };
  }

  it("leaves a small file with a small raster alone", async () => {
    const { close } = stubCanvas(1000, 800);
    const f = file("a.png", "image/png", 1000);
    expect(await downscaleForUpload(f)).toBe(f);
    expect(close).toHaveBeenCalled();
  });

  it("scales a large raster to 2048 on the longest side and exports JPEG at 0.9", async () => {
    const { canvas } = stubCanvas(4000, 3000);
    const out = await downscaleForUpload(file("IMG_1.HEIC.jpg", "image/jpeg", 2000));
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(1536);
    expect(canvas.requested).toEqual({ type: "image/jpeg", q: 0.9 });
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("IMG_1.HEIC.jpg");
  });

  it("downscales a file over the byte cap even when the raster is small", async () => {
    const { canvas } = stubCanvas(1500, 1000, 500);
    const out = await downscaleForUpload(file("big.png", "image/png", MAX_BYTES + 1));
    expect(canvas.width).toBe(1500);
    expect(out.size).toBe(500);
    expect(out.name).toBe("big.png");
    expect(out.type).toBe("image/png");
  });

  it("a PNG source is exported as PNG with no fill and no quality argument", async () => {
    const { canvas, fillRect } = stubCanvas(4000, 3000);
    const out = await downscaleForUpload(file("logo.png", "image/png", 2000));
    expect(canvas.requested).toEqual({ type: "image/png", q: undefined });
    expect(fillRect).not.toHaveBeenCalled();
    expect(out.type).toBe("image/png");
  });

  it("a JPEG or WebP source is flattened onto white and exported as JPEG", async () => {
    const { fillRect } = stubCanvas(4000, 3000);
    const out = await downscaleForUpload(file("a.webp", "image/webp", 2000));
    expect(fillRect).toHaveBeenCalled();
    expect(out.name).toBe("a.jpg");
  });
});
