import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Stripe client before importing the module under test.
vi.mock("@/lib/stripe", () => {
  const list = vi.fn();
  return { stripe: { promotionCodes: { list } } };
});

async function getList() {
  const mod = (await import("@/lib/stripe")) as unknown as {
    stripe: { promotionCodes: { list: ReturnType<typeof vi.fn> } };
  };
  return mod.stripe.promotionCodes.list;
}

// Build a Stripe promotion-code list response with sensible live defaults,
// overridable per field.
function promoCodeResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: [
      {
        active: true,
        expires_at: null,
        max_redemptions: null,
        times_redeemed: 0,
        ...overrides,
      },
    ],
  };
}

const PROMO = { code: "TESTCODE", blurb: "50% off" };

describe("checkPromoLive", () => {
  beforeEach(async () => {
    (await getList()).mockReset();
  });

  it("is live for an active, uncapped code", async () => {
    (await getList()).mockResolvedValue(promoCodeResponse());
    const { checkPromoLive } = await import("../promotion");
    expect(await checkPromoLive(PROMO)).toBe(true);
  });

  it("hides when the code is exhausted (times_redeemed >= max_redemptions)", async () => {
    (await getList()).mockResolvedValue(
      promoCodeResponse({ max_redemptions: 5, times_redeemed: 5 })
    );
    const { checkPromoLive } = await import("../promotion");
    expect(await checkPromoLive(PROMO)).toBe(false);
  });

  it("hides when the code is inactive (covers an invalid/exhausted coupon)", async () => {
    (await getList()).mockResolvedValue(promoCodeResponse({ active: false }));
    const { checkPromoLive } = await import("../promotion");
    expect(await checkPromoLive(PROMO)).toBe(false);
  });

  it("hides when the code has expired", async () => {
    const past = Math.floor((Date.now() - 60_000) / 1000);
    (await getList()).mockResolvedValue(
      promoCodeResponse({ expires_at: past })
    );
    const { checkPromoLive } = await import("../promotion");
    expect(await checkPromoLive(PROMO)).toBe(false);
  });

  it("hides when no matching code exists", async () => {
    (await getList()).mockResolvedValue({ data: [] });
    const { checkPromoLive } = await import("../promotion");
    expect(await checkPromoLive(PROMO)).toBe(false);
  });

  it("fails closed when Stripe throws", async () => {
    (await getList()).mockRejectedValue(new Error("network"));
    const { checkPromoLive } = await import("../promotion");
    expect(await checkPromoLive(PROMO)).toBe(false);
  });
});
