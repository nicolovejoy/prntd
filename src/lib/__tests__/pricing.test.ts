import { describe, it, expect } from "vitest";
import {
  computePrice,
  computeOrderTotal,
  estimateShipping,
  FLAT_SHIPPING_USD,
  MARGIN_MULTIPLIER,
} from "../pricing";
import { PRODUCTS } from "../products";

describe("computePrice", () => {
  it("prices the default Classic Tee at its fixed retail price, ignoring generation cost", () => {
    const result = computePrice(0);
    // bella-canvas-3001 (default) carries a fixed retailPrice; baseCost is the
    // real Printful cost (S–XL $11.69), but the customer pays the $19.43 floor.
    expect(result.baseCost).toBe(11.69);
    expect(result.generationCost).toBe(0);
    expect(result.total).toBe(19.43);
  });

  it("returns generation cost but does not charge the customer for it", () => {
    const withoutGen = computePrice(0);
    const withGen = computePrice(0.15);
    expect(withGen.generationCost).toBe(0.15);
    // Total is identical — generation cost is tracked, not billed
    expect(withGen.total).toBe(withoutGen.total);
  });

  it("holds the flat floor on common sizes and adds the cost delta on 2XL", () => {
    // Flat floor + 2XL upcharge: S–XL stay at the $19.43 floor, 2XL adds the
    // real $2.00 cost delta ($11.69 → $13.69) to reach $21.43.
    expect(computePrice(0, "bella-canvas-3001", "S").total).toBe(19.43);
    expect(computePrice(0, "bella-canvas-3001", "XL").total).toBe(19.43);
    const twoXL = computePrice(0, "bella-canvas-3001", "2XL");
    expect(twoXL.baseCost).toBe(13.69);
    expect(twoXL.total).toBe(21.43);
  });

  it("tracks large generation costs without affecting total", () => {
    const result = computePrice(1.5);
    expect(result.generationCost).toBe(1.5);
    expect(result.total).toBe(19.43);
  });

  it("prices off base cost × margin for products without a fixed retail price", () => {
    const result = computePrice(0, "cotton-heritage-mc1087", "M");
    expect(result.baseCost).toBe(17.45);
    expect(result.total).toBe(Math.ceil(17.45 * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("rounds the base-cost path up to the nearest cent", () => {
    // cotton-heritage M: 17.45 × 1.5 = 26.175 → ceil → 26.18
    expect(computePrice(0, "cotton-heritage-mc1087", "M").total).toBe(26.18);
  });

  it("uses size-specific base cost for products with per-size pricing", () => {
    const result = computePrice(0, "cotton-heritage-mc1087", "2XL");
    expect(result.baseCost).toBe(19.45);
    expect(result.total).toBe(Math.ceil(19.45 * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("adds flat shipping on top of the product price as the grand total", () => {
    const b = computeOrderTotal(19.43);
    expect(b.item).toBe(19.43);
    expect(b.shipping).toBe(FLAT_SHIPPING_USD);
    expect(b.total).toBe(Math.round((19.43 + FLAT_SHIPPING_USD) * 100) / 100);
  });

  it("keeps the grand total at exact cent precision", () => {
    // item + shipping could introduce a float artifact; the breakdown must
    // round to cents so it matches what Stripe charges.
    const b = computeOrderTotal(19.43);
    expect(Math.round(b.total * 100) / 100).toBe(b.total);
  });

  it("charges shipping once per order, not per item (#26 contract)", () => {
    // itemPrice is the summed subtotal; itemCount drives shipping only.
    // Forward-compat for the multi-item cart (#26): shipping stays flat per
    // order today, so a 3-item order pays one shipping charge.
    const b = computeOrderTotal(19.43 * 3, 3);
    expect(b.item).toBe(19.43 * 3);
    expect(b.shipping).toBe(FLAT_SHIPPING_USD);
    expect(b.total).toBe(Math.round((19.43 * 3 + FLAT_SHIPPING_USD) * 100) / 100);
  });

  it("produces an exact-cent total for every product and size", () => {
    // Stripe charges integer cents (unit_amount = round(total*100)). A total
    // with sub-cent precision (e.g. a retailPrice typo of 19.435) would be
    // silently rounded at checkout, so the displayed and charged prices would
    // diverge. Assert every catalog price is already at cent precision.
    for (const p of PRODUCTS) {
      for (const size of p.sizes) {
        const { total } = computePrice(0, p.id, size);
        expect(Math.round(total * 100) / 100).toBe(total);
      }
    }
  });
});

describe("estimateShipping", () => {
  it("is the flat rate for a one-item order (the default)", () => {
    expect(estimateShipping()).toBe(FLAT_SHIPPING_USD);
    expect(estimateShipping(1)).toBe(FLAT_SHIPPING_USD);
  });

  it("is still flat for multiple items today (live quote deferred to #26)", () => {
    expect(estimateShipping(3)).toBe(FLAT_SHIPPING_USD);
  });

  it("ships nothing for an empty cart", () => {
    expect(estimateShipping(0)).toBe(0);
  });
});
