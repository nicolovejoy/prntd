import { describe, it, expect } from "vitest";
import {
  computeProceeds,
  minViablePrice,
  suggestedPrice,
  priceForProceeds,
  PRNTD_OPS_FEE,
  MIN_ORG_PROCEEDS,
  FLAT_SHIPPING_USD,
  calculateStripeFee,
} from "../pricing";

// The organizer-flow proceeds split (docs/organizer-pivot-plan.md → "Phase 2
// economics"): organizer sets the price; PRNTD takes a fixed ops fee; the org
// gets the remainder after Stripe + COGS. COGS is passed in (a baseCost-based
// estimate at compose, the real invoice at settle), so these helpers stay pure.

describe("computeProceeds", () => {
  it("splits a sale into the org's share after Stripe, COGS and the PRNTD ops fee", () => {
    const cogs = 17.5;
    const b = computeProceeds(25, cogs);
    expect(b.price).toBe(25);
    expect(b.shipping).toBe(FLAT_SHIPPING_USD);
    expect(b.gross).toBe(29.69);
    expect(b.stripeFee).toBe(calculateStripeFee(29.69));
    expect(b.cogs).toBe(cogs);
    expect(b.opsFee).toBe(PRNTD_OPS_FEE);
    // gross − fee − cogs − ops, rounded to the cent
    const expected =
      Math.round((29.69 - calculateStripeFee(29.69) - cogs - PRNTD_OPS_FEE) * 100) / 100;
    expect(b.orgProceeds).toBe(expected);
  });

  it("can go negative when the price doesn't even cover costs", () => {
    const b = computeProceeds(5, 17.5);
    expect(b.orgProceeds).toBeLessThan(0);
  });

  it("charges shipping once per order, not per item", () => {
    const one = computeProceeds(25, 17.5, 1);
    const three = computeProceeds(25, 17.5, 3);
    expect(one.shipping).toBe(three.shipping);
  });
});

describe("priceForProceeds", () => {
  it("inverts computeProceeds: pricing at the result yields ~the target proceeds", () => {
    const cogs = 16.38;
    const p = priceForProceeds(cogs, 8);
    const proceeds = computeProceeds(p, cogs).orgProceeds;
    expect(proceeds).toBeGreaterThanOrEqual(8);
    expect(proceeds).toBeLessThan(8.02); // tight: rounding only
  });
});

describe("minViablePrice", () => {
  it("is the lowest price that still clears the $5 org-proceeds floor", () => {
    const cogs = 17.5;
    const floor = minViablePrice(cogs);
    expect(computeProceeds(floor, cogs).orgProceeds).toBeGreaterThanOrEqual(
      MIN_ORG_PROCEEDS
    );
    // a cent under the floor dips below the guarantee
    expect(
      computeProceeds(Math.round((floor - 0.01) * 100) / 100, cogs).orgProceeds
    ).toBeLessThan(MIN_ORG_PROCEEDS);
  });

  it("matches the documented ~$19.82 floor for a $17.50-COGS blank", () => {
    expect(minViablePrice(17.5)).toBeCloseTo(19.82, 2);
  });

  it("rises with COGS", () => {
    expect(minViablePrice(20)).toBeGreaterThan(minViablePrice(12));
  });
});

describe("suggestedPrice", () => {
  it("clears the floor and gives the org a healthier cut than the minimum", () => {
    const cogs = 16.38;
    const suggested = suggestedPrice(cogs);
    expect(suggested).toBeGreaterThanOrEqual(minViablePrice(cogs));
    expect(computeProceeds(suggested, cogs).orgProceeds).toBeGreaterThan(
      MIN_ORG_PROCEEDS
    );
  });
});

describe("constants", () => {
  it("ops fee is $1 and the org floor is $5 (the agreed knobs)", () => {
    expect(PRNTD_OPS_FEE).toBe(1.0);
    expect(MIN_ORG_PROCEEDS).toBe(5.0);
  });
});
