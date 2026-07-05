import {
  getBlankOrThrow,
  getBaseCost,
  getRetailPrice,
  ACTIVE_BLANKS,
  DEFAULT_BLANK_ID,
} from "./blanks";

export const MARGIN_MULTIPLIER = 1.5;

/**
 * Stripe processing fee — 2.9% + $0.30 on the full charge (item + shipping).
 * Lives here (the pure, db-free pricing module) as the single source of truth;
 * `ledger.ts` re-exports it so the `@/lib/ledger` import path keeps working.
 */
export const STRIPE_FEE_RATE = 0.029;
export const STRIPE_FEE_FIXED = 0.3;

export function calculateStripeFee(amount: number): number {
  return Math.round((amount * STRIPE_FEE_RATE + STRIPE_FEE_FIXED) * 100) / 100;
}

/**
 * Organizer-flow knobs (docs/organizer-pivot-plan.md → "Phase 2 economics").
 * PRNTD's fixed cut per product, and the floor the org is guaranteed per sale.
 * Both are starting values — single named constants so they're one-line tunable.
 */
export const PRNTD_OPS_FEE = 1.0;
export const MIN_ORG_PROCEEDS = 5.0;

/** A healthier-than-floor default the compose form pre-fills as the suggestion. */
const SUGGESTED_ORG_PROCEEDS = 8.0;

/**
 * Customer upcharge for adding a back design (#25). Flat across products. Rides
 * the discountable product Stripe line (a back is product value, so % promos
 * apply to it). The underlying Printful COGS for the extra placement is ~$5.95
 * flat (measured via /orders/estimate-costs, 2026-06-07, uniform across all
 * three shirts); the rest is margin. COGS itself is still read back from
 * Printful's real invoice post-submission, so this constant only sets price.
 */
export const BACK_PLACEMENT_UPCHARGE = 8.0;

/**
 * Flat US shipping charged as a SEPARATE Stripe line (shipping_options),
 * not a line item — so percentage promo codes discount only the product,
 * never shipping (the margin fix). A live per-destination Printful quote is
 * deferred to #26 (multi-item cart), where bundled-shipping savings actually
 * surface; hosted Stripe Checkout can't recompute shipping after the buyer
 * enters their address anyway, so a single US item is effectively flat.
 */
export const FLAT_SHIPPING_USD = 4.69;

/**
 * Shipping for an order of `itemCount` items. Flat per order today; the
 * itemCount arg is accepted now so callers are forward-compatible with #26,
 * which swaps in a live Printful quote that prices bundled shipping. An empty
 * cart ships nothing.
 */
export function estimateShipping(itemCount: number = 1): number {
  return itemCount > 0 ? FLAT_SHIPPING_USD : 0;
}

export type PriceBreakdown = {
  /** Product subtotal — the only part a percentage promo discounts. */
  item: number;
  shipping: number;
  /** Grand total = item + shipping, at cent precision. */
  total: number;
};

/**
 * Combine a product price with shipping into the order grand total. Single
 * source of truth for the breakdown the /order + buy panel UIs display and
 * the checkout choke point charges, so the shown total and the Stripe total
 * can't drift.
 */
export function computeOrderTotal(
  itemPrice: number,
  itemCount: number = 1
): PriceBreakdown {
  const shipping = estimateShipping(itemCount);
  return {
    item: itemPrice,
    shipping,
    total: Math.round((itemPrice + shipping) * 100) / 100,
  };
}

/**
 * Combine N line-item prices with one order-level shipping charge into the cart
 * grand total (#26 Stage B). Shipping is charged once per order, not per item —
 * the bundled-shipping savings — so the caller passes a single shipping value
 * (the live Printful quote, or the flat fallback). Empty cart → all zeroes.
 */
export function computeCartTotal(
  itemPrices: number[],
  shipping: number
): PriceBreakdown {
  const item = Math.round(itemPrices.reduce((sum, p) => sum + p, 0) * 100) / 100;
  const ship = itemPrices.length > 0 ? shipping : 0;
  return {
    item,
    shipping: ship,
    total: Math.round((item + ship) * 100) / 100,
  };
}

/**
 * Customer-facing price. A product either prices off its real per-size cost
 * (total = baseCost × margin, rounded up to the cent) or pins a fixed
 * `retailPrice` per size, which takes precedence — letting a product hold a
 * flat floor on common sizes and add only the real cost delta on larger ones.
 *
 * `generationCost` (AI API cost) is passed through for internal tracking only
 * — it does NOT affect the total. It's still returned in the result so admin
 * views and the ledger can surface it, but the customer never sees or pays it.
 */
export function computePrice(
  generationCost: number,
  productId: string = DEFAULT_BLANK_ID,
  size: string = "M",
  opts: { back?: boolean } = {}
): { baseCost: number; generationCost: number; total: number } {
  const product = getBlankOrThrow(productId);
  const baseCost = getBaseCost(product, size);
  const retail = getRetailPrice(product, size);
  const front = retail ?? Math.ceil(baseCost * MARGIN_MULTIPLIER * 100) / 100;
  // Back upcharge adds to the product line (so promos discount it). Rounded to
  // the cent to stay aligned with the front computation.
  const total =
    Math.round((front + (opts.back ? BACK_PLACEMENT_UPCHARGE : 0)) * 100) / 100;

  return { baseCost, generationCost, total };
}

/**
 * Cheapest customer-facing price across the active catalog (any blank, any
 * size, front only). Derived from the same computePrice the checkout charges,
 * so marketing copy like the landing's "Tees from $X" can never go stale.
 * (Lives here rather than blanks.ts because it needs the margin computation,
 * and blanks.ts importing pricing.ts would be circular.)
 */
export function minRetailPrice(): number {
  let min = Infinity;
  for (const blank of ACTIVE_BLANKS) {
    for (const size of blank.sizes) {
      const { total } = computePrice(0, blank.id, size);
      if (total < min) min = total;
    }
  }
  return min;
}

export type ProceedsBreakdown = {
  /** The organizer's item price (what they set). */
  price: number;
  /** Shipping charged to the customer, once per order. */
  shipping: number;
  /** What the customer pays: price + shipping. */
  gross: number;
  stripeFee: number;
  /** COGS — a baseCost-based estimate at compose, the real invoice at settle. */
  cogs: number;
  opsFee: number;
  /** What flows to the organizer's org. Can be negative below break-even. */
  orgProceeds: number;
};

/**
 * The organizer-flow split for one product sale. The organizer sets `price`;
 * PRNTD takes a fixed ops fee; the org receives the remainder after Stripe and
 * COGS. Shipping is ≈ pass-through (we charge it; Printful's real ship cost is
 * inside `cogs`), kept a separate line so % promos never eat it (the 1B fix).
 * Pure — `cogs` is supplied by the caller, so no network/DB here.
 */
export function computeProceeds(
  price: number,
  cogs: number,
  itemCount: number = 1
): ProceedsBreakdown {
  const shipping = estimateShipping(itemCount);
  const gross = Math.round((price + shipping) * 100) / 100;
  const stripeFee = calculateStripeFee(gross);
  const orgProceeds =
    Math.round((gross - stripeFee - cogs - PRNTD_OPS_FEE) * 100) / 100;
  return { price, shipping, gross, stripeFee, cogs, opsFee: PRNTD_OPS_FEE, orgProceeds };
}

/**
 * Invert the split: the item price at which the org nets `targetProceeds`.
 * Solve gross·(1−rate) − fixed − cogs − ops = target for gross, then subtract
 * shipping. Used by the floor + suggested-price helpers below.
 */
export function priceForProceeds(
  cogs: number,
  targetProceeds: number,
  itemCount: number = 1
): number {
  const shipping = estimateShipping(itemCount);
  const gross =
    (targetProceeds + STRIPE_FEE_FIXED + cogs + PRNTD_OPS_FEE) /
    (1 - STRIPE_FEE_RATE);
  return Math.round((gross - shipping) * 100) / 100;
}

/**
 * The soft-warn floor: the lowest price that still clears the $5 org guarantee.
 * Rounded UP to the cent so the rounded price never lands a hair under the
 * guarantee. Below this the compose form warns (but never blocks).
 */
export function minViablePrice(cogs: number, itemCount: number = 1): number {
  const exact = priceForProceeds(cogs, MIN_ORG_PROCEEDS, itemCount);
  return Math.ceil(exact * 100) / 100;
}

/** A pre-fill price targeting a healthier-than-floor org cut, rounded to the dollar. */
export function suggestedPrice(cogs: number, itemCount: number = 1): number {
  const exact = priceForProceeds(cogs, SUGGESTED_ORG_PROCEEDS, itemCount);
  return Math.ceil(exact);
}

/**
 * Destination-free COGS estimate for the compose form, where there's no buyer
 * address yet (the live `/orders/estimate-costs` quote needs one). Proxy: the
 * per-size product+print cost (`baseCost`) plus the flat shipping we'd collect
 * — Printful's real ship cost is ≈ what we charge, so this approximates the full
 * invoice total. The actual COGS reconciles against Printful's invoice at
 * settle; this only drives the live proceeds/floor the organizer sees.
 */
export function estimateComposeCogs(
  blankId: string = DEFAULT_BLANK_ID,
  size: string = "M"
): number {
  const blank = getBlankOrThrow(blankId);
  return Math.round((getBaseCost(blank, size) + estimateShipping()) * 100) / 100;
}
