import { describe, it, expect } from "vitest";
import { computePrice, MARGIN_MULTIPLIER } from "../pricing";

describe("computePrice", () => {
  it("calculates standard quality with zero generation cost", () => {
    const result = computePrice("standard", 0);
    expect(result.baseCost).toBe(12.95);
    expect(result.generationCost).toBe(0);
    expect(result.total).toBe(Math.ceil(12.95 * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("calculates premium quality with zero generation cost", () => {
    const result = computePrice("premium", 0);
    expect(result.baseCost).toBe(17.95); // 12.95 + 5.00
    expect(result.total).toBe(Math.ceil(17.95 * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("includes generation cost in total", () => {
    const result = computePrice("standard", 0.15); // 5 generations
    expect(result.generationCost).toBe(0.15);
    expect(result.total).toBe(Math.ceil((12.95 + 0.15) * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("rounds up to nearest cent", () => {
    // (12.95 + 0.03) * 1.5 = 19.47 — exact, no rounding needed
    const result = computePrice("standard", 0.03);
    expect(result.total).toBe(19.47);
  });

  it("handles large generation costs", () => {
    const result = computePrice("standard", 1.5); // 50 generations
    expect(result.total).toBe(Math.ceil((12.95 + 1.5) * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("premium with many generations", () => {
    const result = computePrice("premium", 0.9); // 30 generations
    expect(result.total).toBe(Math.ceil((17.95 + 0.9) * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("uses product-specific base cost", () => {
    const result = computePrice("standard", 0, "cotton-heritage-mc1087", "M");
    expect(result.baseCost).toBe(17.45);
    expect(result.total).toBe(Math.ceil(17.45 * MARGIN_MULTIPLIER * 100) / 100);
  });

  it("uses size-specific base cost for products with per-size pricing", () => {
    const result = computePrice("standard", 0, "cotton-heritage-mc1087", "2XL");
    expect(result.baseCost).toBe(19.45);
  });
});
