import {
  getProductOrThrow,
  getBaseCost,
  DEFAULT_PRODUCT_ID,
  type Product,
} from "./products";

export const MARGIN_MULTIPLIER = 1.5;

export function computePrice(
  generationCost: number,
  productId: string = DEFAULT_PRODUCT_ID,
  size: string = "M"
): { baseCost: number; generationCost: number; total: number } {
  const product = getProductOrThrow(productId);
  const baseCost = getBaseCost(product, size);
  const subtotal = (baseCost + generationCost) * MARGIN_MULTIPLIER;
  const total = Math.ceil(subtotal * 100) / 100;

  return { baseCost, generationCost, total };
}
