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
  totalPrice: number;
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
          unit_amount: Math.round(params.totalPrice * 100),
        },
        quantity: 1,
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
