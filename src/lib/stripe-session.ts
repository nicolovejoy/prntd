/**
 * One translation from a retrieved Stripe Checkout Session (expanded with
 * `total_details.breakdown.discounts.discount`) to the plain StripeSessionData
 * the webhook handler consumes. Shared by the live webhook route and the admin
 * recovery action so the two can't drift — they had: the recovery copy dropped
 * amountSubtotal/amountShipping, so recovered orders never persisted the
 * item/shipping price split.
 *
 * Throws when orderId/designId metadata is missing. The promotion-code lookup
 * is injected; a lookup failure degrades the code to "unknown", never throws.
 */
import type Stripe from "stripe";
import type { StripeSessionData } from "@/lib/webhook-handlers";

export async function toStripeSessionData(
  fullSession: Stripe.Checkout.Session,
  deps: {
    /** Resolve a promotion_code id to its human code (e.g. "HALF"). */
    retrievePromotionCode: (id: string) => Promise<string | null>;
  }
): Promise<StripeSessionData> {
  const orderId = fullSession.metadata?.orderId;
  const designId = fullSession.metadata?.designId;
  if (!orderId || !designId) {
    throw new Error(
      `Stripe session ${fullSession.id} missing orderId/designId metadata`
    );
  }

  const shipping = fullSession.collected_information?.shipping_details;
  const paymentIntentId =
    typeof fullSession.payment_intent === "string"
      ? fullSession.payment_intent
      : fullSession.payment_intent?.id ?? null;

  const discountEntry = fullSession.total_details?.breakdown?.discounts?.[0];
  let discount: StripeSessionData["discount"] = null;
  if (discountEntry && discountEntry.amount > 0) {
    const promoCodeId = discountEntry.discount.promotion_code;
    let code: string | null = null;
    if (typeof promoCodeId === "string") {
      try {
        code = await deps.retrievePromotionCode(promoCodeId);
      } catch (err) {
        console.error("Failed to retrieve promotion code:", err);
      }
    }
    discount = {
      code: code ?? "unknown",
      amount: discountEntry.amount / 100,
    };
  }

  return {
    id: fullSession.id,
    metadata: { orderId, designId },
    paymentIntentId,
    amountTotal: fullSession.amount_total,
    amountSubtotal: fullSession.amount_subtotal,
    amountShipping: fullSession.total_details?.amount_shipping ?? null,
    discount,
    shipping: shipping
      ? {
          name: shipping.name ?? "",
          address1: shipping.address?.line1 ?? "",
          address2: shipping.address?.line2 ?? "",
          city: shipping.address?.city ?? "",
          state: shipping.address?.state ?? "",
          zip: shipping.address?.postal_code ?? "",
          country: shipping.address?.country ?? "US",
        }
      : null,
  };
}
