/**
 * toStripeSessionData — the single Stripe-session translation shared by the
 * webhook route and admin recovery. The amountSubtotal/amountShipping cases
 * lock the exact drift the duplicated copies had (recovery dropped both, so
 * recovered orders never persisted the price split).
 */
import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { toStripeSessionData } from "@/lib/stripe-session";

function makeFullSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_123",
    metadata: { orderId: "order-1", designId: "design-1" },
    payment_intent: "pi_123",
    amount_total: 2412,
    amount_subtotal: 1943,
    total_details: { amount_shipping: 469 },
    collected_information: {
      shipping_details: {
        name: "Jane Doe",
        address: {
          line1: "1 Main St",
          line2: "Apt 2",
          city: "Town",
          state: "CA",
          postal_code: "90001",
          country: "US",
        },
      },
    },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

const noPromo = { retrievePromotionCode: vi.fn() };

describe("toStripeSessionData", () => {
  it("maps the full session including the price split", async () => {
    const data = await toStripeSessionData(makeFullSession(), noPromo);

    expect(data).toEqual({
      id: "cs_test_123",
      metadata: { orderId: "order-1", designId: "design-1" },
      paymentIntentId: "pi_123",
      amountTotal: 2412,
      amountSubtotal: 1943,
      amountShipping: 469,
      discount: null,
      shipping: {
        name: "Jane Doe",
        address1: "1 Main St",
        address2: "Apt 2",
        city: "Town",
        state: "CA",
        zip: "90001",
        country: "US",
      },
    });
  });

  it("throws when orderId/designId metadata is missing", async () => {
    await expect(
      toStripeSessionData(makeFullSession({ metadata: {} }), noPromo)
    ).rejects.toThrow(/missing orderId\/designId/);
  });

  it("normalizes an expanded payment_intent object to its id", async () => {
    const data = await toStripeSessionData(
      makeFullSession({ payment_intent: { id: "pi_obj" } }),
      noPromo
    );
    expect(data.paymentIntentId).toBe("pi_obj");
  });

  it("handles a null payment_intent and missing shipping", async () => {
    const data = await toStripeSessionData(
      makeFullSession({ payment_intent: null, collected_information: null }),
      noPromo
    );
    expect(data.paymentIntentId).toBeNull();
    expect(data.shipping).toBeNull();
  });

  it("defaults amountShipping to null when total_details is absent", async () => {
    const data = await toStripeSessionData(
      makeFullSession({ total_details: undefined }),
      noPromo
    );
    expect(data.amountShipping).toBeNull();
  });

  it("resolves the discount's promotion code", async () => {
    const retrievePromotionCode = vi.fn().mockResolvedValue("HALF");
    const data = await toStripeSessionData(
      makeFullSession({
        total_details: {
          amount_shipping: 469,
          breakdown: {
            discounts: [{ amount: 971, discount: { promotion_code: "promo_1" } }],
          },
        },
      }),
      { retrievePromotionCode }
    );

    expect(retrievePromotionCode).toHaveBeenCalledWith("promo_1");
    expect(data.discount).toEqual({ code: "HALF", amount: 9.71 });
  });

  it("degrades the code to 'unknown' when the promo lookup fails", async () => {
    const data = await toStripeSessionData(
      makeFullSession({
        total_details: {
          breakdown: {
            discounts: [{ amount: 500, discount: { promotion_code: "promo_x" } }],
          },
        },
      }),
      { retrievePromotionCode: vi.fn().mockRejectedValue(new Error("gone")) }
    );
    expect(data.discount).toEqual({ code: "unknown", amount: 5 });
  });

  it("uses 'unknown' when the promotion_code is not a string id", async () => {
    const data = await toStripeSessionData(
      makeFullSession({
        total_details: {
          breakdown: {
            discounts: [{ amount: 500, discount: { promotion_code: { id: "x" } } }],
          },
        },
      }),
      noPromo
    );
    expect(data.discount).toEqual({ code: "unknown", amount: 5 });
  });

  it("treats a zero-amount discount entry as no discount", async () => {
    const data = await toStripeSessionData(
      makeFullSession({
        total_details: {
          breakdown: {
            discounts: [{ amount: 0, discount: { promotion_code: "promo_1" } }],
          },
        },
      }),
      noPromo
    );
    expect(data.discount).toBeNull();
  });
});
