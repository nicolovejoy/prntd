import { describe, it, expect } from "vitest";
import { computePrice, MARGIN_MULTIPLIER } from "../pricing";

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
});
