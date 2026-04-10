import { describe, it, expect } from "vitest";
import { computePrice, MARGIN_MULTIPLIER } from "../pricing";

describe("computePrice", () => {
  it("calculates total from base cost × margin multiplier, ignoring generation cost", () => {
    const result = computePrice(0);
    expect(result.baseCost).toBe(12.95);
    expect(result.generationCost).toBe(0);
    expect(result.total).toBe(Math.ceil(12.95 * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("returns generation cost but does not charge the customer for it", () => {
    const withoutGen = computePrice(0);
    const withGen = computePrice(0.15);
    expect(withGen.generationCost).toBe(0.15);
    // Total is identical — generation cost is tracked, not billed
    expect(withGen.total).toBe(withoutGen.total);
  });

  it("rounds total up to the nearest cent", () => {
    const result = computePrice(0);
    // 12.95 × 1.5 = 19.425 → ceil → 19.43
    expect(result.total).toBe(19.43);
  });

  it("tracks large generation costs without affecting total", () => {
    const result = computePrice(1.5);
    expect(result.generationCost).toBe(1.5);
    expect(result.total).toBe(Math.ceil(12.95 * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("uses product-specific base cost", () => {
    const result = computePrice(0, "cotton-heritage-mc1087", "M");
    expect(result.baseCost).toBe(17.45);
    expect(result.total).toBe(Math.ceil(17.45 * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("uses size-specific base cost for products with per-size pricing", () => {
    const result = computePrice(0, "cotton-heritage-mc1087", "2XL");
    expect(result.baseCost).toBe(19.45);
  });
});
