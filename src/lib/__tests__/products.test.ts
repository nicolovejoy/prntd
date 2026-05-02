import { describe, it, expect } from "vitest";
import {
  getProduct,
  getProductOrThrow,
  getBaseCost,
  getVariantId,
  getDefaultPlacement,
  needsAspectRegeneration,
  PRODUCTS,
  DEFAULT_PRODUCT_ID,
} from "../products";

describe("getProduct", () => {
  it("returns product by id", () => {
    const product = getProduct("bella-canvas-3001");
    expect(product).toBeDefined();
    expect(product!.name).toBe("Classic Tee");
  });

  it("returns undefined for unknown id", () => {
    expect(getProduct("nonexistent")).toBeUndefined();
  });
});

describe("getProductOrThrow", () => {
  it("returns product by id", () => {
    const product = getProductOrThrow("bella-canvas-3001");
    expect(product.name).toBe("Classic Tee");
  });

  it("throws for unknown id", () => {
    expect(() => getProductOrThrow("nonexistent")).toThrow("Unknown product: nonexistent");
  });
});

describe("getBaseCost", () => {
  it("returns flat cost for product with wildcard pricing", () => {
    const product = getProductOrThrow("bella-canvas-3001");
    expect(getBaseCost(product, "M")).toBe(12.95);
    expect(getBaseCost(product, "2XL")).toBe(12.95);
  });

  it("returns size-specific cost for per-size pricing", () => {
    const product = getProductOrThrow("cotton-heritage-mc1087");
    expect(getBaseCost(product, "M")).toBe(17.45);
    expect(getBaseCost(product, "2XL")).toBe(19.45);
    expect(getBaseCost(product, "3XL")).toBe(21.45);
  });

  it("falls back to wildcard for unlisted size", () => {
    const product = getProductOrThrow("clear-case-iphone");
    // iPhone SE not in explicit pricing → falls to "*" at 9.38
    expect(getBaseCost(product, "iPhone SE")).toBe(9.38);
    // iPhone 14 has explicit pricing
    expect(getBaseCost(product, "iPhone 14")).toBe(10.95);
  });
});

describe("getVariantId", () => {
  it("returns variant id for valid combo", () => {
    const product = getProductOrThrow("bella-canvas-3001");
    expect(getVariantId(product, "White", "M")).toBe(4012);
  });

  it("returns undefined for invalid color", () => {
    const product = getProductOrThrow("bella-canvas-3001");
    expect(getVariantId(product, "Neon Pink", "M")).toBeUndefined();
  });

  it("returns undefined for invalid size", () => {
    const product = getProductOrThrow("bella-canvas-3001");
    expect(getVariantId(product, "White", "5XL")).toBeUndefined();
  });
});

describe("PRODUCTS", () => {
  it("has at least one product", () => {
    expect(PRODUCTS.length).toBeGreaterThan(0);
  });

  it("default product exists", () => {
    expect(getProduct(DEFAULT_PRODUCT_ID)).toBeDefined();
  });

  it("every product has at least one color and size", () => {
    for (const p of PRODUCTS) {
      expect(p.colors.length).toBeGreaterThan(0);
      expect(p.sizes.length).toBeGreaterThan(0);
    }
  });

  it("every product has a valid mockupPosition", () => {
    for (const p of PRODUCTS) {
      expect(p.mockupPosition.area_width).toBeGreaterThan(0);
      expect(p.mockupPosition.area_height).toBeGreaterThan(0);
      expect(p.mockupPosition.width).toBeGreaterThan(0);
      expect(p.mockupPosition.height).toBeGreaterThan(0);
    }
  });

  it("every product has at least one placement with a valid aspectRatio", () => {
    for (const p of PRODUCTS) {
      expect(p.placements.length).toBeGreaterThan(0);
      for (const pl of p.placements) {
        expect(pl.id).toBeTruthy();
        expect(pl.aspectRatio).toMatch(/^\d+:\d+$/);
        expect(pl.printArea.width).toBeGreaterThan(0);
        expect(pl.printArea.height).toBeGreaterThan(0);
      }
    }
  });

  it("default placement mirrors top-level mockupPosition/printArea (Phase 1 invariant)", () => {
    for (const p of PRODUCTS) {
      const front = getDefaultPlacement(p);
      expect(front.mockupPosition).toEqual(p.mockupPosition);
      expect(front.printArea).toEqual(p.printArea);
    }
  });
});

describe("needsAspectRegeneration", () => {
  it("is false when aspects are identical", () => {
    expect(needsAspectRegeneration("1:1", "1:1")).toBe(false);
    expect(needsAspectRegeneration("1:2", "1:2")).toBe(false);
  });

  it("is true for 1:1 → 1:2 (phone case crop bug)", () => {
    expect(needsAspectRegeneration("1:1", "1:2")).toBe(true);
  });

  it("is false for 1:1 → 3:4 (default tee — letterboxes acceptably)", () => {
    expect(needsAspectRegeneration("1:1", "3:4")).toBe(false);
  });

  it("is false for 1:1 → 4:5 (women's tee)", () => {
    expect(needsAspectRegeneration("1:1", "4:5")).toBe(false);
  });

  it("is symmetric", () => {
    expect(needsAspectRegeneration("1:2", "1:1")).toBe(true);
    expect(needsAspectRegeneration("3:4", "1:1")).toBe(false);
  });

  it("is true when going between very different aspects", () => {
    expect(needsAspectRegeneration("3:4", "1:2")).toBe(true);
    expect(needsAspectRegeneration("1:2", "2:1")).toBe(true);
  });
});
