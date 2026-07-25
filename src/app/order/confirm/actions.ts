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

  const lines = resolveOrderLines(items).map((l) => ({
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
