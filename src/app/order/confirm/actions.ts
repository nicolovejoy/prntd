"use server";

import { db } from "@/lib/db";
import {
  order as orderTable,
  orderItem as orderItemTable,
} from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { resolveOrderLines } from "@/lib/order-lines";

export async function getOrderBySession(stripeSessionId: string) {
  const found = await db.query.order.findFirst({
    where: eq(orderTable.stripeSessionId, stripeSessionId),
  });

  if (!found) return null;

  // Cart orders (#26) carry their shirts in order_item; legacy single-item
  // orders fall back to the scalar columns. resolveOrderLines unifies both so
  // a multi-item confirmation lists every shirt, not just the first.
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

  const lines = resolveOrderLines(found, items).map((l) => ({
    blankId: l.blankId,
    size: l.size,
    color: l.color,
    quantity: l.quantity,
  }));

  return {
    id: found.id,
    status: found.status,
    totalPrice: found.totalPrice,
    lines,
  };
}
