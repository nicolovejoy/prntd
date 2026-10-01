import { describe, it, expect } from "vitest";
import {
  computePrice,
  computeOrderTotal,
  computeCartTotal,
  estimateShipping,
  FLAT_SHIPPING_USD,
  MARGIN_MULTIPLIER,
  calculateStripeFee,
  priceFromCost,
  BACK_PLACEMENT_UPCHARGE,
} from "../pricing";
import { BLANKS, getBaseCost, getRetailPrice } from "../blanks";

describe("computePrice", () => {
  it("prices the default Classic Tee at its fixed retail price, ignoring generation cost", () => {
    const result = computePrice(0);
    // bella-canvas-3001 (default) carries a fixed retailPrice; baseCost is the
    // Printful list price (S–XL $11.92), but the customer pays the $19.43 floor.
    expect(result.baseCost).toBe(11.92);
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
    // real $2.00 cost delta ($11.92 → $13.92) to reach $21.43.
    expect(computePrice(0, "bella-canvas-3001", "S").total).toBe(19.43);
    expect(computePrice(0, "bella-canvas-3001", "XL").total).toBe(19.43);
    const twoXL = computePrice(0, "bella-canvas-3001", "2XL");
    expect(twoXL.baseCost).toBe(13.92);
    expect(twoXL.total).toBe(21.43);
  });

  it("tracks large generation costs without affecting total", () => {
    const result = computePrice(1.5);
    expect(result.generationCost).toBe(1.5);
    expect(result.total).toBe(19.43);
  });

  it("prices off base cost × margin for products without a fixed retail price", () => {
    const result = computePrice(0, "cotton-heritage-mc1087", "M");
    expect(result.baseCost).toBe(17.8);
    // 17.80 × 1.4 = 24.92
    expect(result.total).toBe(24.92);
  });

  it("rounds the base-cost path up to the nearest cent", () => {
    // women's relaxed M: 13.96 × 1.4 = 19.544 → 19.55
    expect(computePrice(0, "bella-canvas-6400", "M").total).toBe(19.55);
  });

  it("uses size-specific base cost for products with per-size pricing", () => {
    const result = computePrice(0, "cotton-heritage-mc1087", "2XL");
    expect(result.baseCost).toBe(19.8);
    // 19.80 × 1.4 = 27.72
    expect(result.total).toBe(27.72);
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

  it("leaves the total unchanged when no back design is added (#25)", () => {
    expect(computePrice(0, "bella-canvas-3001", "M", {}).total).toBe(19.43);
    expect(computePrice(0, "bella-canvas-3001", "M", { back: false }).total).toBe(
      19.43
    );
  });

  it("adds exactly the back upcharge to the product line (#25)", () => {
    const front = computePrice(0, "bella-canvas-3001", "M").total;
    const withBack = computePrice(0, "bella-canvas-3001", "M", { back: true });
    expect(withBack.total).toBe(
      Math.round((front + BACK_PLACEMENT_UPCHARGE) * 100) / 100
    );
    expect(withBack.total).toBe(27.43);
  });

  it("applies the back upcharge on the base-cost path too, at cent precision", () => {
    const front = computePrice(0, "cotton-heritage-mc1087", "M").total;
    const withBack = computePrice(0, "cotton-heritage-mc1087", "M", {
      back: true,
    });
    expect(withBack.total).toBe(
      Math.round((front + BACK_PLACEMENT_UPCHARGE) * 100) / 100
    );
    expect(Math.round(withBack.total * 100) / 100).toBe(withBack.total);
  });

  it("produces an exact-cent total for every product and size", () => {
    // Stripe charges integer cents (unit_amount = round(total*100)). A total
    // with sub-cent precision (e.g. a retailPrice typo of 19.435) would be
    // silently rounded at checkout, so the displayed and charged prices would
    // diverge. Assert every catalog price is already at cent precision.
    for (const p of BLANKS) {
      for (const size of p.sizes) {
        const { total } = computePrice(0, p.id, size);
        expect(Math.round(total * 100) / 100).toBe(total);
      }
    }
  });
});

describe("catalog base costs", () => {
  it("every blank has a positive baseCost for every size it sells", () => {
    for (const p of BLANKS) {
      for (const size of p.sizes) {
        expect(getBaseCost(p, size), `${p.id} ${size}`).toBeGreaterThan(0);
      }
    }
  });

  it("holds the Classic Tee customer price independent of baseCost", () => {
    // retailPrice is an owner decision (2026-06-06); a baseCost refresh
    // (2026-10-01) must not move it.
    for (const size of ["S", "M", "L", "XL"]) {
      expect(computePrice(0, "bella-canvas-3001", size).total).toBe(19.43);
    }
    expect(computePrice(0, "bella-canvas-3001", "2XL").total).toBe(21.43);
  });
});

// Independent exact calculation: BigInt cents × BigInt hundredths, ceiling
// division by 100, no floats past the string parse.
function exactPriceCents(cost: number, mult: number): bigint {
  const cents = BigInt(Math.round(cost * 100));
  const hundredths = BigInt(Math.round(mult * 100));
  const prod = cents * hundredths; // ten-thousandths of a dollar
  return (prod + BigInt(99)) / BigInt(100);
}

describe("priceFromCost", () => {
  const multipliers = [MARGIN_MULTIPLIER, 1.5, 1.4, 1.3];

  // priceFromCost rounds the multiplier and each cost to hundredths before
  // multiplying, so a third decimal on either would be dropped silently.
  it("is only fed two-decimal inputs: the multiplier and every base cost", () => {
    const hasTwoDecimals = (n: number) =>
      Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;
    expect(hasTwoDecimals(MARGIN_MULTIPLIER)).toBe(true);
    for (const blank of BLANKS) {
      for (const cost of Object.values(blank.baseCost)) {
        expect(hasTwoDecimals(cost)).toBe(true);
      }
    }
  });

  it("matches an exact calculation for every blank and size without a retailPrice", () => {
    for (const p of BLANKS) {
      for (const size of p.sizes) {
        if (getRetailPrice(p, size) !== undefined) continue;
        const cost = getBaseCost(p, size);
        for (const m of multipliers) {
          expect(
            Math.round(priceFromCost(cost, m) * 100),
            `${p.id} ${size} x${m}`
          ).toBe(Number(exactPriceCents(cost, m)));
        }
      }
    }
  });

  it("matches the exact calculation for every two-decimal cost from 5.00 to 40.00", () => {
    for (let c = 500; c <= 4000; c++) {
      for (const m of multipliers) {
        expect(Math.round(priceFromCost(c / 100, m) * 100)).toBe(
          Number(exactPriceCents(c / 100, m))
        );
      }
    }
  });

  it("does not add a cent for float noise (costs that exposed the artifact)", () => {
    // At 1.5, a float ceil gave 26.71 for 17.80 (17.8 × 1.5 × 100 =
    // 2670.0000000000005); the exact products are below.
    expect(priceFromCost(17.8, 1.5)).toBe(26.7);
    expect(priceFromCost(19.8, 1.5)).toBe(29.7);
    expect(priceFromCost(21.8, 1.5)).toBe(32.7);
    expect(priceFromCost(23.8, 1.5)).toBe(35.7);
    expect(priceFromCost(17.8)).toBe(24.92);
    expect(priceFromCost(19.8)).toBe(27.72);
    expect(priceFromCost(17.8, 1.4)).toBe(24.92);
    expect(priceFromCost(17.8, 1.3)).toBe(23.14);
  });

  it("leaves every price from the previous base costs unchanged", () => {
    // Base costs before the 2026-10-01 refresh, with the prices main charged.
    const before: [number, number][] = [
      [17.45, 26.18], [19.45, 29.18], [21.45, 32.18], [23.45, 35.18],
      [13.69, 20.54], [15.69, 23.54], [17.69, 26.54],
      [9.38, 14.07], [10.95, 16.43], [11.69, 17.54], [13.69, 20.54],
    ];
    for (const [cost, price] of before) {
      expect(priceFromCost(cost, 1.5), String(cost)).toBe(price);
    }
  });

  it("rounds a genuine fraction of a cent up", () => {
    expect(priceFromCost(9.57, 1.5)).toBe(14.36); // 14.355
    expect(priceFromCost(11.17, 1.5)).toBe(16.76); // 16.755
    expect(priceFromCost(17.45, 1.5)).toBe(26.18); // 26.175
    expect(priceFromCost(9.57)).toBe(13.4); // 13.398 at 1.4
    expect(priceFromCost(13.96)).toBe(19.55); // 19.544 at 1.4
  });

  it("sells no size below base cost plus the Stripe fee on the item", () => {
    // Before shipping: item price − Stripe fee on that price must cover cost.
    for (const p of BLANKS) {
      for (const size of p.sizes) {
        const price = computePrice(0, p.id, size).total;
        const cost = getBaseCost(p, size);
        expect(
          price,
          `${p.id} ${size}`
        ).toBeGreaterThanOrEqual(cost + calculateStripeFee(price));
      }
    }
  });
});

describe("computeCartTotal", () => {
  it("sums N line-item prices with one order-level shipping charge", () => {
    const b = computeCartTotal([19.43, 19.43, 21.43], FLAT_SHIPPING_USD);
    expect(b.item).toBe(19.43 + 19.43 + 21.43);
    expect(b.shipping).toBe(FLAT_SHIPPING_USD);
    expect(b.total).toBe(
      Math.round((19.43 + 19.43 + 21.43 + FLAT_SHIPPING_USD) * 100) / 100
    );
  });

  it("charges shipping once regardless of item count (bundled-shipping contract)", () => {
    const one = computeCartTotal([19.43], FLAT_SHIPPING_USD);
    const three = computeCartTotal([19.43, 19.43, 19.43], FLAT_SHIPPING_USD);
    expect(one.shipping).toBe(FLAT_SHIPPING_USD);
    expect(three.shipping).toBe(FLAT_SHIPPING_USD);
  });

  it("passes through a live (non-flat) shipping quote unchanged", () => {
    const b = computeCartTotal([19.43, 19.43], 8.5);
    expect(b.shipping).toBe(8.5);
    expect(b.total).toBe(Math.round((19.43 + 19.43 + 8.5) * 100) / 100);
  });

  it("charges no shipping for an empty cart, even if a shipping quote is passed", () => {
    const b = computeCartTotal([], FLAT_SHIPPING_USD);
    expect(b.item).toBe(0);
    expect(b.shipping).toBe(0);
    expect(b.total).toBe(0);
  });

  it("rounds the item subtotal to exact cent precision", () => {
    // Three prices whose float sum can carry sub-cent error.
    const b = computeCartTotal([19.43, 19.43, 19.43], FLAT_SHIPPING_USD);
    expect(Math.round(b.item * 100) / 100).toBe(b.item);
    expect(Math.round(b.total * 100) / 100).toBe(b.total);
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
