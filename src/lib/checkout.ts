import type Stripe from "stripe";

/**
 * Build the Stripe Checkout Session params for a single-item PRNTD order.
 * Pure — no db, no network — so the wiring is unit-tested independently
 * of the server actions that create the order row and call Stripe.
 *
 * Both the design-your-own flow (`createCheckoutSession`) and the
 * buy-existing flow (`buyPublishedDesign`) build their session through
 * here so the line-item shape, metadata, and URLs can't drift apart.
 * The only per-flow difference is `cancelUrl` — where the customer lands
 * if they back out.
 */
export function buildCheckoutSessionParams(params: {
  orderId: string;
  designId: string;
  productName: string;
  color: string;
  size: string;
  /** Product price — the single line item, the only part promos discount. */
  itemPrice: number;
  /** Shipping — a separate shipping_options line, excluded from % promos. */
  shippingPrice: number;
  imageUrl: string | null;
  cancelUrl: string;
  appUrl: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    allow_promotion_codes: true,
    shipping_address_collection: {
      allowed_countries: ["US"],
    },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `PRNTD ${params.productName}`,
            description: `${params.color} / ${params.size}`,
            images: params.imageUrl ? [params.imageUrl] : [],
          },
          unit_amount: Math.round(params.itemPrice * 100),
        },
        quantity: 1,
      },
    ],
    // Shipping as a shipping_option, NOT a second line item: Stripe applies
    // percentage promotion codes only to line items, so charging shipping
    // here keeps a 50%-off code from eating shipping margin to zero.
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: {
            amount: Math.round(params.shippingPrice * 100),
            currency: "usd",
          },
          display_name: "Standard shipping",
        },
      },
    ],
    metadata: {
      orderId: params.orderId,
      designId: params.designId,
    },
    success_url: `${params.appUrl}/order/confirm?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: params.cancelUrl,
  };
}
