import type Stripe from "stripe";

/**
 * Stripe Checkout Sessions expire on their own — after that,
 * `checkout.session.expired` fires and the webhook marks the order abandoned
 * if it's still `pending`. Stripe's floor is 30 minutes, but this TTL is an
 * owner-facing behaviour, not just a margin-over-Stripe's-floor number: 2
 * hours covers a buyer who gets interrupted mid-checkout (a phone call, a
 * distracted tab) without leaving their pending order ambiguous for the 24h
 * Stripe would otherwise sit on it before its own default expiry. The
 * `/orders` staleness window (`STALE_PENDING_MS`, src/lib/user-orders.ts)
 * sits 15 minutes above this value so a session that's still technically
 * live never gets flagged stale first.
 */
export const CHECKOUT_SESSION_TTL_SECONDS = 2 * 60 * 60;

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
  /** Injected clock (ms) for `expires_at` — defaults to `Date.now()`. */
  now?: number;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    allow_promotion_codes: true,
    expires_at:
      Math.floor((params.now ?? Date.now()) / 1000) +
      CHECKOUT_SESSION_TTL_SECONDS,
    shipping_address_collection: {
      allowed_countries: ["US"],
    },
    // One product line item (the multi-item cart, #26, makes this N lines or
    // a quantity > 1). Shipping stays a single shipping_option regardless of
    // item count — see estimateShipping / computeOrderTotal.
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

/**
 * Multi-item (cart) variant of the above (#26 Stage B). N product line items +
 * one bundled shipping_option for the whole order — shipping is charged once,
 * not per item, and stays out of percentage promos (same margin fix). Kept
 * separate from the single-item builder so that flow's locked shape can't
 * drift; both share the shipping-as-option pattern and URL/metadata wiring.
 */
export function buildCartCheckoutSessionParams(params: {
  orderId: string;
  /** Representative design id for metadata (the order spans many designs). */
  designId: string;
  lineItems: {
    name: string;
    description: string;
    imageUrl: string | null;
    /** Per-unit product price (the discountable part). */
    unitPrice: number;
    quantity: number;
  }[];
  /** Bundled shipping for the whole order — one separate Stripe line. */
  shippingPrice: number;
  cancelUrl: string;
  appUrl: string;
  /** Injected clock (ms) for `expires_at` — defaults to `Date.now()`. */
  now?: number;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    allow_promotion_codes: true,
    expires_at:
      Math.floor((params.now ?? Date.now()) / 1000) +
      CHECKOUT_SESSION_TTL_SECONDS,
    shipping_address_collection: { allowed_countries: ["US"] },
    line_items: params.lineItems.map((li) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: `PRNTD ${li.name}`,
          description: li.description,
          images: li.imageUrl ? [li.imageUrl] : [],
        },
        unit_amount: Math.round(li.unitPrice * 100),
      },
      quantity: li.quantity,
    })),
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
    metadata: { orderId: params.orderId, designId: params.designId },
    success_url: `${params.appUrl}/order/confirm?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: params.cancelUrl,
  };
}
