import { db } from "@/lib/db";
import {
  order as orderTable,
  orderItem as orderItemTable,
} from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { resolveOrderLines } from "@/lib/order-lines";
import { resolveOrderLineIdentities } from "@/lib/order-line-identity";

/**
 * The /order/confirm receipt, for the order's owner only (#317 item 3): any
 * other viewer gets `null`, the same as an unknown session id, so the page
 * leaks nothing about whether the order exists. A plain lib read, not a
 * `"use server"` action, so it is never reachable as an action endpoint.
 */
export async function getOrderReceipt(params: {
  stripeSessionId: string;
  viewerId: string;
}) {
  const found = await db.query.order.findFirst({
    where: eq(orderTable.stripeSessionId, params.stripeSessionId),
  });

  if (!found || found.userId !== params.viewerId) return null;

  // Every purchased shirt is an order_item row (authoritative since Phase 1c),
  // so a multi-item confirmation lists them all, not just the first.
  const items = await db
    .select({
      designId: orderItemTable.designId,
      productId: orderItemTable.productId,
      size: orderItemTable.size,
      color: orderItemTable.color,
      quantity: orderItemTable.quantity,
      placements: orderItemTable.placements,
      itemPrice: orderItemTable.itemPrice,
      printfulCost: orderItemTable.printfulCost,
    })
    .from(orderItemTable)
    .where(eq(orderItemTable.orderId, found.id))
    .orderBy(asc(orderItemTable.createdAt));

  const resolved = resolveOrderLines(items);
  // Front + back thumbnails (#167), one batched call for the whole order —
  // the same mapper /orders and the admin order detail use.
  const identities = await resolveOrderLineIdentities(
    db,
    resolved.map((l) => ({ designId: l.designId, placements: l.placements }))
  );

  const lines = resolved.map((l, i) => ({
    blankId: l.blankId,
    size: l.size,
    color: l.color,
    quantity: l.quantity,
    imageUrl: identities[i].imageUrl,
    backImageUrl: identities[i].backImageUrl,
  }));

  return {
    id: found.id,
    status: found.status,
    abandoned: found.abandonedAt != null,
    totalPrice: found.totalPrice,
    lines,
  };
}
