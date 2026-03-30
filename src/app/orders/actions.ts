"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  order as orderTable,
  design as designTable,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function getUserOrders() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  return db
    .select({
      id: orderTable.id,
      status: orderTable.status,
      size: orderTable.size,
      color: orderTable.color,
      quality: orderTable.quality,
      totalPrice: orderTable.totalPrice,
      trackingNumber: orderTable.trackingNumber,
      trackingUrl: orderTable.trackingUrl,
      createdAt: orderTable.createdAt,
      designImageUrl: designTable.currentImageUrl,
    })
    .from(orderTable)
    .leftJoin(designTable, eq(orderTable.designId, designTable.id))
    .where(eq(orderTable.userId, session.user.id))
    .orderBy(desc(orderTable.createdAt));
}
