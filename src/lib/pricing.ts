import { PRINTFUL_BASE_COST, PREMIUM_UPCHARGE } from "./printful";

export const MARGIN_MULTIPLIER = 1.5;

export function computePrice(
  quality: "standard" | "premium",
  generationCost: number
): { baseCost: number; generationCost: number; total: number } {
  const baseCost =
    PRINTFUL_BASE_COST + (quality === "premium" ? PREMIUM_UPCHARGE : 0);
  const subtotal = (baseCost + generationCost) * MARGIN_MULTIPLIER;
  const total = Math.ceil(subtotal * 100) / 100;

  return { baseCost, generationCost, total };
}
