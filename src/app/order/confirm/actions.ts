"use server";

import { db } from "@/lib/db";
import { order as orderTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function getOrderBySession(stripeSessionId: string) {
  const found = await db.query.order.findFirst({
    where: eq(orderTable.stripeSessionId, stripeSessionId),
  });

  if (!found) return null;

  return {
    id: found.id,
    status: found.status,
    size: found.size,
    color: found.color,
    totalPrice: found.totalPrice,
  };
}
