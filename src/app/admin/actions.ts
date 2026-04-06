"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  order as orderTable,
  design as designTable,
  user as userTable,
  ledgerEntry,
} from "@/lib/db/schema";
import { eq, desc, isNull, isNotNull, sum, count, and } from "drizzle-orm";
import { createOrder } from "@/lib/printful";
import { getProductOrThrow, getVariantId } from "@/lib/products";
import { assertTransition } from "@/lib/order-state";
import { ORDER_CLASSIFICATIONS, type OrderClassification } from "@/lib/order-classification";

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
      printfulCost: orderTable.printfulCost,
      printfulOrderId: orderTable.printfulOrderId,
      trackingNumber: orderTable.trackingNumber,
      trackingUrl: orderTable.trackingUrl,
      shippingName: orderTable.shippingName,
      shippingAddress1: orderTable.shippingAddress1,
      shippingCity: orderTable.shippingCity,
      shippingState: orderTable.shippingState,
      shippingZip: orderTable.shippingZip,
      shippingCountry: orderTable.shippingCountry,
      tags: orderTable.tags,
      classification: orderTable.classification,
      archivedAt: orderTable.archivedAt,
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

  const product = getProductOrThrow(foundOrder.productId ?? "bella-canvas-3001");
  const variantId = getVariantId(product, foundOrder.color, foundOrder.size);
  if (!variantId) {
    throw new Error(`No variant for ${foundOrder.color} ${foundOrder.size} on ${product.name}`);
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

  const printfulCost = printfulOrder.costs?.total
    ? parseFloat(printfulOrder.costs.total)
    : null;

  await db
    .update(orderTable)
    .set({
      status: "submitted",
      printfulOrderId: String(printfulOrder.id),
      printfulCost,
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

export async function archiveOrder(orderId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  const found = await db.query.order.findFirst({
    where: eq(orderTable.id, orderId),
  });
  if (!found) throw new Error("Order not found");
  if (found.status === "shipped" || found.status === "delivered" || found.trackingNumber || found.printfulOrderId) {
    throw new Error("Cannot archive orders submitted to Printful");
  }

  await db
    .update(orderTable)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(orderTable.id, orderId));
}

export async function unarchiveOrder(orderId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  await db
    .update(orderTable)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(orderTable.id, orderId));
}

export async function getFinancialSummary(classificationFilter?: OrderClassification | "all") {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  const filterClassification = classificationFilter && classificationFilter !== "all"
    ? classificationFilter
    : null;

  // Ledger-based: sum by entry type, optionally filtered by order classification
  const ledgerQuery = filterClassification
    ? db
        .select({
          type: ledgerEntry.type,
          total: sum(ledgerEntry.amount),
        })
        .from(ledgerEntry)
        .innerJoin(orderTable, eq(ledgerEntry.orderId, orderTable.id))
        .where(eq(orderTable.classification, filterClassification))
        .groupBy(ledgerEntry.type)
    : db
        .select({
          type: ledgerEntry.type,
          total: sum(ledgerEntry.amount),
        })
        .from(ledgerEntry)
        .groupBy(ledgerEntry.type);

  const entries = await ledgerQuery;

  const byType: Record<string, number> = {};
  for (const e of entries) {
    byType[e.type] = parseFloat(e.total ?? "0");
  }

  const sales = byType["sale"] ?? 0;
  const stripeFees = byType["stripe_fee"] ?? 0;
  const cogs = byType["cogs"] ?? 0;
  const refunds = byType["refund"] ?? 0;

  const orderConditions = [isNull(orderTable.archivedAt)];
  if (filterClassification) {
    orderConditions.push(eq(orderTable.classification, filterClassification));
  }

  const countRows = await db
    .select({ orderCount: count() })
    .from(orderTable)
    .where(and(...orderConditions));
  const orderCount = countRows[0].orderCount;

  const revenue = sales + refunds;

  return {
    revenue,
    stripeFees,
    cogs: Math.abs(cogs),
    grossProfit: revenue + stripeFees + cogs,
    orderCount,
  };
}

export async function setOrderTags(orderId: string, tags: string[]) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  await db
    .update(orderTable)
    .set({ tags, updatedAt: new Date() })
    .where(eq(orderTable.id, orderId));
}

export async function setOrderClassification(orderId: string, classification: OrderClassification) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  if (!ORDER_CLASSIFICATIONS.includes(classification)) {
    throw new Error(`Invalid classification: ${classification}`);
  }

  await db
    .update(orderTable)
    .set({ classification, updatedAt: new Date() })
    .where(eq(orderTable.id, orderId));
}

export async function getAdminData() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  const [orders, ledger] = await Promise.all([
    db
      .select({
        id: orderTable.id,
        status: orderTable.status,
        size: orderTable.size,
        color: orderTable.color,
        quality: orderTable.quality,
        totalPrice: orderTable.totalPrice,
        printfulCost: orderTable.printfulCost,
        printfulOrderId: orderTable.printfulOrderId,
        trackingNumber: orderTable.trackingNumber,
        trackingUrl: orderTable.trackingUrl,
        shippingName: orderTable.shippingName,
        shippingAddress1: orderTable.shippingAddress1,
        shippingCity: orderTable.shippingCity,
        shippingState: orderTable.shippingState,
        shippingZip: orderTable.shippingZip,
        shippingCountry: orderTable.shippingCountry,
        tags: orderTable.tags,
        classification: orderTable.classification,
        archivedAt: orderTable.archivedAt,
        createdAt: orderTable.createdAt,
        userEmail: userTable.email,
        designImageUrl: designTable.currentImageUrl,
        designId: orderTable.designId,
      })
      .from(orderTable)
      .leftJoin(userTable, eq(orderTable.userId, userTable.id))
      .leftJoin(designTable, eq(orderTable.designId, designTable.id))
      .orderBy(desc(orderTable.createdAt)),
    db
      .select({
        id: ledgerEntry.id,
        orderId: ledgerEntry.orderId,
        type: ledgerEntry.type,
        amount: ledgerEntry.amount,
        currency: ledgerEntry.currency,
        description: ledgerEntry.description,
        metadata: ledgerEntry.metadata,
        createdAt: ledgerEntry.createdAt,
      })
      .from(ledgerEntry)
      .orderBy(desc(ledgerEntry.createdAt)),
  ]);

  return { orders, ledger };
}

export async function getOrderDetail(orderId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  const [orders, ledger] = await Promise.all([
    db
      .select({
        id: orderTable.id,
        status: orderTable.status,
        size: orderTable.size,
        color: orderTable.color,
        quality: orderTable.quality,
        totalPrice: orderTable.totalPrice,
        printfulCost: orderTable.printfulCost,
        printfulOrderId: orderTable.printfulOrderId,
        trackingNumber: orderTable.trackingNumber,
        trackingUrl: orderTable.trackingUrl,
        shippingName: orderTable.shippingName,
        shippingAddress1: orderTable.shippingAddress1,
        shippingAddress2: orderTable.shippingAddress2,
        shippingCity: orderTable.shippingCity,
        shippingState: orderTable.shippingState,
        shippingZip: orderTable.shippingZip,
        shippingCountry: orderTable.shippingCountry,
        stripeSessionId: orderTable.stripeSessionId,
        stripePaymentIntentId: orderTable.stripePaymentIntentId,
        tags: orderTable.tags,
        classification: orderTable.classification,
        archivedAt: orderTable.archivedAt,
        createdAt: orderTable.createdAt,
        updatedAt: orderTable.updatedAt,
        userEmail: userTable.email,
        designImageUrl: designTable.currentImageUrl,
        designId: orderTable.designId,
      })
      .from(orderTable)
      .leftJoin(userTable, eq(orderTable.userId, userTable.id))
      .leftJoin(designTable, eq(orderTable.designId, designTable.id))
      .where(eq(orderTable.id, orderId)),
    db.query.ledgerEntry.findMany({
      where: eq(ledgerEntry.orderId, orderId),
      orderBy: (entry, { asc }) => [asc(entry.createdAt)],
    }),
  ]);

  if (orders.length === 0) throw new Error("Order not found");

  return { ...orders[0], ledger };
}
