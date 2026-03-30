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
import { createOrder, TSHIRT_VARIANTS } from "@/lib/printful";
import { assertTransition } from "@/lib/order-state";

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
      trackingNumber: orderTable.trackingNumber,
      trackingUrl: orderTable.trackingUrl,
      shippingName: orderTable.shippingName,
      shippingAddress1: orderTable.shippingAddress1,
      shippingCity: orderTable.shippingCity,
      shippingState: orderTable.shippingState,
      shippingZip: orderTable.shippingZip,
      shippingCountry: orderTable.shippingCountry,
      createdAt: orderTable.createdAt,
      userEmail: userTable.email,
      designImageUrl: designTable.currentImageUrl,
      designId: orderTable.designId,
    })
    .from(orderTable)
    .leftJoin(userTable, eq(orderTable.userId, userTable.id))
    .leftJoin(designTable, eq(orderTable.designId, designTable.id))
    .orderBy(desc(orderTable.createdAt));
}

export async function retryPrintfulSubmission(orderId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  const foundOrder = await db.query.order.findFirst({
    where: eq(orderTable.id, orderId),
  });

  if (!foundOrder) throw new Error("Order not found");
  assertTransition(foundOrder.status, "submitted");

  // Get design image
  const foundDesign = await db.query.design.findFirst({
    where: eq(designTable.id, foundOrder.designId),
  });

  if (!foundDesign?.currentImageUrl) {
    throw new Error("Design has no image");
  }

  const variantId = TSHIRT_VARIANTS[foundOrder.color]?.[foundOrder.size];
  if (!variantId) {
    throw new Error(`No variant for ${foundOrder.color} ${foundOrder.size}`);
  }

  const printfulOrder = await createOrder({
    designImageUrl: foundDesign.currentImageUrl,
    size: foundOrder.size,
    color: foundOrder.color,
    variantId,
    recipientName: foundOrder.shippingName ?? "",
    address1: foundOrder.shippingAddress1 ?? "",
    address2: foundOrder.shippingAddress2 ?? undefined,
    city: foundOrder.shippingCity ?? "",
    stateCode: foundOrder.shippingState ?? "",
    countryCode: foundOrder.shippingCountry ?? "US",
    zip: foundOrder.shippingZip ?? "",
  });

  await db
    .update(orderTable)
    .set({
      status: "submitted",
      printfulOrderId: String(printfulOrder.id),
      updatedAt: new Date(),
    })
    .where(eq(orderTable.id, orderId));

  // Mark design as ordered
  await db
    .update(designTable)
    .set({ status: "ordered", updatedAt: new Date() })
    .where(eq(designTable.id, foundOrder.designId));

  return { printfulOrderId: printfulOrder.id };
}
