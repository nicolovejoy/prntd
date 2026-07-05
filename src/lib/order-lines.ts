/**
 * One source of truth for "what was bought" on an order.
 *
 * Orders carry purchased items two ways today: legacy single-item orders store
 * the item in scalar columns on `order` (size/color/productId/placements/…),
 * while cart orders (#26) store one `order_item` row per shirt. This normalizer
 * collapses both into a single `OrderLine[]` so read sites — orders page, admin,
 * emails, fulfillment — don't branch on which representation an order uses.
 *
 * It also exposes the blank catalog id as `blankId` rather than the legacy
 * `productId` name (the column holds a *blank* id, e.g. "bella-canvas-3001",
 * not a `product.id`). This is the read-layer half of the productId→blankId
 * rename — see docs/data-model-simplification-plan.md.
 *
 * Pure: no DB access. Callers pass the order row + its order_item rows.
 */

export type OrderLine = {
  designId: string;
  /** Blank catalog id (blanks.ts). The legacy column is named `product_id`. */
  blankId: string;
  size: string;
  color: string;
  quantity: number;
  /** placement key → design_image id. Defaults to {} when unset. */
  placements: Record<string, string>;
  itemPrice: number | null;
  printfulCost: number | null;
};

/** The legacy scalar item fields carried on the `order` row. */
type OrderScalars = {
  designId: string;
  productId: string;
  size: string;
  color: string;
  placements: Record<string, string> | null;
  itemPrice: number | null;
  printfulCost: number | null;
};

/** An `order_item` row. */
export type OrderItemRow = {
  designId: string;
  productId: string;
  size: string;
  color: string;
  quantity: number;
  placements: Record<string, string> | null;
  itemPrice: number | null;
  printfulCost: number | null;
};

export function resolveOrderLines(
  order: OrderScalars,
  items: OrderItemRow[]
): OrderLine[] {
  // order_item rows are authoritative when present; the scalar columns are the
  // legacy single-item fallback.
  if (items.length > 0) {
    return items.map((item) => ({
      designId: item.designId,
      blankId: item.productId,
      size: item.size,
      color: item.color,
      quantity: item.quantity,
      placements: item.placements ?? {},
      itemPrice: item.itemPrice,
      printfulCost: item.printfulCost,
    }));
  }

  return [
    {
      designId: order.designId,
      blankId: order.productId,
      size: order.size,
      color: order.color,
      quantity: 1,
      placements: order.placements ?? {},
      itemPrice: order.itemPrice,
      printfulCost: order.printfulCost,
    },
  ];
}
