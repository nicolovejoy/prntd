import {
  getProductOrThrow,
  getBaseCost,
  DEFAULT_PRODUCT_ID,
  type Product,
} from "./products";

export const MARGIN_MULTIPLIER = 1.5;

/**
 * Customer-facing price = baseCost × margin multiplier.
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
  const subtotal = baseCost * MARGIN_MULTIPLIER;
  const total = Math.ceil(subtotal * 100) / 100;

  return { baseCost, generationCost, total };
}
