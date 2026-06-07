import {
  getProductOrThrow,
  getBaseCost,
  getRetailPrice,
  DEFAULT_PRODUCT_ID,
} from "./products";

export const MARGIN_MULTIPLIER = 1.5;

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
  productId: string = DEFAULT_PRODUCT_ID,
  size: string = "M"
): { baseCost: number; generationCost: number; total: number } {
  const product = getProductOrThrow(productId);
  const baseCost = getBaseCost(product, size);
  const retail = getRetailPrice(product, size);
  const total =
    retail ?? Math.ceil(baseCost * MARGIN_MULTIPLIER * 100) / 100;

  return { baseCost, generationCost, total };
}
