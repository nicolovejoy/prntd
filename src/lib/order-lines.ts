/**
 * One source of truth for "what was bought" on an order.
 *
 * `order_item` is authoritative (data-model Phase 1c): every order carries one
 * row per shirt, and the per-item scalar columns that used to sit on `order`
 * are gone (migration 0006 backfilled a line for every order that lacked one,
 * then dropped them). This maps those rows to the shape read sites use.
 *
 * It exposes the blank catalog id as `blankId` rather than the legacy
 * `productId` name (the column holds a *blank* id, e.g. "bella-canvas-3001",
 * not a `product.id`). This is the read-layer half of the productId→blankId
 * rename — see docs/data-model-simplification-plan.md.
 *
 * Pure: no DB access. Callers pass the order's order_item rows.
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

export function resolveOrderLines(items: OrderItemRow[]): OrderLine[] {
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
