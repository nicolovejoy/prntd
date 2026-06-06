import {
  getProductOrThrow,
  getBaseCost,
  getRetailPrice,
  DEFAULT_PRODUCT_ID,
} from "./products";

export const MARGIN_MULTIPLIER = 1.5;

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
