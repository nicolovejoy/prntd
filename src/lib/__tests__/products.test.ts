import { describe, it, expect } from "vitest";
import {
  getProduct,
  getProductOrThrow,
  getBaseCost,
  getVariantId,
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
});
