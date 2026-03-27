"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  order as orderTable,
  design as designTable,
  user as userTable,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

const ADMIN_EMAIL = "nicholas.lovejoy@gmail.com";

export async function getOrders() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  return db
    .select({
      id: orderTable.id,
      status: orderTable.status,
      size: orderTable.size,
      color: orderTable.color,
      quality: orderTable.quality,
      totalPrice: orderTable.totalPrice,
      printfulOrderId: orderTable.printfulOrderId,
      shippingName: orderTable.shippingName,
      shippingCity: orderTable.shippingCity,
      shippingState: orderTable.shippingState,
      createdAt: orderTable.createdAt,
      userEmail: userTable.email,
      designImageUrl: designTable.currentImageUrl,
    })
    .from(orderTable)
    .leftJoin(userTable, eq(orderTable.userId, userTable.id))
    .leftJoin(designTable, eq(orderTable.designId, designTable.id))
    .orderBy(desc(orderTable.createdAt));
}
