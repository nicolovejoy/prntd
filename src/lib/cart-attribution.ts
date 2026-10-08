/**
 * Which Shop composition (`product` row) a cart order is attributed to
 * (`order.store_product_id`, #289 item 2).
 *
 * The column lives on the order header, but a cart order can carry lines from
 * several compositions. The order is attributed only when every published line
 * names the same composition and at least one line is published; otherwise the
 * answer is null. Unpublished lines (the buyer's own work) have no composition
 * and do not count either way. Per-line attribution would need an
 * `order_item` column and is out of scope.
 */
export function cartOrderStoreProductId(
  lines: Array<{ published: boolean; storeProductId: string | null }>
): string | null {
  let shared: string | null = null;
  for (const line of lines) {
    if (!line.published) continue;
    if (!line.storeProductId) return null;
    if (shared === null) shared = line.storeProductId;
    else if (shared !== line.storeProductId) return null;
  }
  return shared;
}
