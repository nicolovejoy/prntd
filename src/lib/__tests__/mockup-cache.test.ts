import { describe, it, expect } from "vitest";
import {
  mockupCacheKey,
  mockupCacheProductPrefix,
  mockupObjectKey,
} from "../mockup-cache";

describe("mockupCacheKey", () => {
  it("front key: version, product, placement, color, scale", () => {
    expect(
      mockupCacheKey({
        productId: "bella-canvas-3001",
        placementId: "front",
        colorName: "White",
        scaleKey: 100,
      })
    ).toBe("v2:bella-canvas-3001:front:White:100");
  });

  it("back key inserts the source pick", () => {
    expect(
      mockupCacheKey({
        productId: "bella-canvas-3001",
        placementId: "back",
        sourceImageId: "img-abc",
        colorName: "Black",
        scaleKey: 80,
      })
    ).toBe("v2:bella-canvas-3001:back:img-abc:Black:80");
  });

  it("product prefix matches its keys and only its keys", () => {
    const prefix = mockupCacheProductPrefix("bella-canvas-3001");
    expect(
      mockupCacheKey({
        productId: "bella-canvas-3001",
        placementId: "front",
        colorName: "White",
        scaleKey: 100,
      }).startsWith(prefix)
    ).toBe(true);
    // Pre-#102 entries (no version segment) must not match — their URLs
    // point at collided objects.
    expect("bella-canvas-3001:front:White:100".startsWith(prefix)).toBe(false);
    expect(
      mockupCacheKey({
        productId: "box-tee",
        placementId: "front",
        colorName: "White",
        scaleKey: 100,
      }).startsWith(prefix)
    ).toBe(false);
  });
});

describe("mockupObjectKey", () => {
  const base = {
    productId: "bella-canvas-3001",
    placementId: "back",
    colorName: "Vintage White",
    scaleKey: 100,
  };

  it("distinct back sources → distinct object keys (#102)", () => {
    const a = mockupObjectKey("d1", { ...base, sourceImageId: "src-a" }, "h1");
    const b = mockupObjectKey("d1", { ...base, sourceImageId: "src-b" }, "h1");
    expect(a).not.toBe(b);
  });

  it("distinct products and scales → distinct object keys", () => {
    const tee = mockupObjectKey("d1", base, "h1");
    const box = mockupObjectKey("d1", { ...base, productId: "box-tee" }, "h1");
    const small = mockupObjectKey("d1", { ...base, scaleKey: 60 }, "h1");
    expect(new Set([tee, box, small]).size).toBe(3);
  });

  it("content hash changes the key, so re-renders get fresh URLs", () => {
    expect(mockupObjectKey("d1", base, "aaaa1111")).not.toBe(
      mockupObjectKey("d1", base, "bbbb2222")
    );
  });

  it("slugs multi-word colors and stays under the design's mockups prefix", () => {
    const key = mockupObjectKey("d1", base, "h1");
    expect(key.startsWith("designs/d1/mockups/")).toBe(true);
    expect(key).toContain("vintage-white");
    expect(key.endsWith(".jpg")).toBe(true);
  });
});
