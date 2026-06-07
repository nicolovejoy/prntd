import { describe, it, expect } from "vitest";
import {
  getProduct,
  getProductOrThrow,
  getBaseCost,
  getRetailPrice,
  getVariantId,
  getDefaultPlacement,
  getPlacement,
  getOptionalPlacements,
  productSupportsPlacement,
  multiPlacementEnabled,
  needsAspectRegeneration,
  resolveOrderVariant,
  PRODUCTS,
  ACTIVE_PRODUCTS,
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
  it("returns the real per-size cost for the Classic Tee", () => {
    const product = getProductOrThrow("bella-canvas-3001");
    expect(getBaseCost(product, "M")).toBe(11.69);
    expect(getBaseCost(product, "2XL")).toBe(13.69);
  });

  it("falls back to the wildcard default for unlisted sizes", () => {
    const product = getProductOrThrow("clear-case-iphone");
    expect(getBaseCost(product, "iPhone 15")).toBe(9.38); // "*" default
    expect(getBaseCost(product, "iPhone 14")).toBe(10.95); // explicit override
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

describe("getRetailPrice", () => {
  it("returns the fixed floor for common sizes and the upcharge for 2XL on the Classic Tee", () => {
    const product = getProductOrThrow("bella-canvas-3001");
    expect(getRetailPrice(product, "M")).toBe(19.43); // "*" floor
    expect(getRetailPrice(product, "XL")).toBe(19.43);
    expect(getRetailPrice(product, "2XL")).toBe(21.43); // explicit override
  });

  it("falls back to the wildcard default for sizes without an explicit price", () => {
    const product = getProductOrThrow("bella-canvas-3001");
    expect(getRetailPrice(product, "S")).toBe(19.43); // not listed → "*"
  });

  it("returns undefined for a product that prices purely off baseCost", () => {
    const product = getProductOrThrow("cotton-heritage-mc1087");
    expect(getRetailPrice(product, "M")).toBeUndefined();
    expect(getRetailPrice(product, "2XL")).toBeUndefined();
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

describe("resolveOrderVariant", () => {
  it("returns the product and variant id for a valid combo", () => {
    const { product, variantId } = resolveOrderVariant({
      productId: "bella-canvas-3001",
      size: "M",
      color: "White",
    });
    expect(product.id).toBe("bella-canvas-3001");
    expect(variantId).toBe(4012);
  });

  it("throws on an unknown product", () => {
    expect(() =>
      resolveOrderVariant({ productId: "nope", size: "M", color: "White" })
    ).toThrow(/unknown product/i);
  });

  it("rejects a discontinued product (not orderable, even via a stale link)", () => {
    expect(() =>
      resolveOrderVariant({
        productId: "clear-case-iphone",
        size: "iPhone 16",
        color: "Clear",
      })
    ).toThrow(/no longer available/i);
  });

  it("throws on a size the product doesn't offer", () => {
    expect(() =>
      resolveOrderVariant({
        productId: "bella-canvas-3001",
        size: "5XL",
        color: "White",
      })
    ).toThrow(/size/i);
  });

  it("throws on a color the product doesn't offer", () => {
    expect(() =>
      resolveOrderVariant({
        productId: "bella-canvas-3001",
        size: "M",
        color: "Neon Pink",
      })
    ).toThrow(/color/i);
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

  it("never prices a size below its estimated Printful cost", () => {
    // A retailPrice (or baseCost×margin) below baseCost would sell at a
    // guaranteed loss. baseCost is only an estimate — real COGS comes from
    // Printful's invoice — but pricing under the estimate is always a typo,
    // never intentional. Guards against a fat-fingered retailPrice entry.
    for (const p of PRODUCTS) {
      for (const size of p.sizes) {
        const cost = getBaseCost(p, size);
        const retail = getRetailPrice(p, size);
        const price = retail ?? Math.ceil(cost * 1.5 * 100) / 100;
        expect(price).toBeGreaterThanOrEqual(cost);
      }
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

describe("ACTIVE_PRODUCTS", () => {
  it("excludes discontinued products", () => {
    expect(ACTIVE_PRODUCTS.every((p) => !p.discontinued)).toBe(true);
    expect(ACTIVE_PRODUCTS.find((p) => p.id === "clear-case-iphone")).toBeUndefined();
  });

  it("still resolves discontinued products via getProduct (historical orders)", () => {
    const p = getProduct("clear-case-iphone");
    expect(p).toBeDefined();
    expect(p!.discontinued).toBe(true);
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

describe("placements (#25 back printing)", () => {
  it.each(["bella-canvas-3001", "bella-canvas-6400", "cotton-heritage-mc1087"])(
    "%s exposes an optional back placement mirroring its front",
    (productId) => {
      const product = getProductOrThrow(productId);
      expect(productSupportsPlacement(product, "back")).toBe(true);
      const back = getPlacement(product, "back");
      expect(back.id).toBe("back");
      expect(back.required).toBe(false);
      // Back shares the front's printfile/print area on these tees.
      expect(back.printArea).toEqual(getDefaultPlacement(product).printArea);
      expect(back.aspectRatio).toBe(getDefaultPlacement(product).aspectRatio);
    }
  );

  it("front stays the required default placement", () => {
    const tee = getProductOrThrow("bella-canvas-3001");
    expect(getDefaultPlacement(tee).id).toBe("front");
    expect(getDefaultPlacement(tee).required).toBe(true);
  });

  it("getOptionalPlacements returns add-ons, never the required front", () => {
    const tee = getProductOrThrow("bella-canvas-3001");
    const optional = getOptionalPlacements(tee);
    expect(optional.map((p) => p.id)).toContain("back");
    expect(optional.every((p) => p.required !== true)).toBe(true);
    expect(optional.map((p) => p.id)).not.toContain("front");
  });

  it("the phone case supports no back placement", () => {
    const phone = getProductOrThrow("clear-case-iphone");
    expect(productSupportsPlacement(phone, "back")).toBe(false);
    expect(getOptionalPlacements(phone)).toEqual([]);
  });

  it("getPlacement throws for an unknown placement key", () => {
    const tee = getProductOrThrow("bella-canvas-3001");
    expect(() => getPlacement(tee, "sleeve_left")).toThrow();
  });

  it("multiPlacementEnabled reflects the env flag, default off", () => {
    const prev = process.env.MULTI_PLACEMENT_ENABLED;
    delete process.env.MULTI_PLACEMENT_ENABLED;
    expect(multiPlacementEnabled()).toBe(false);
    process.env.MULTI_PLACEMENT_ENABLED = "true";
    expect(multiPlacementEnabled()).toBe(true);
    if (prev === undefined) delete process.env.MULTI_PLACEMENT_ENABLED;
    else process.env.MULTI_PLACEMENT_ENABLED = prev;
  });
});
