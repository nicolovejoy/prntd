"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  order as orderTable,
  design as designTable,
  designImage as designImageTable,
  user as userTable,
  ledgerEntry,
} from "@/lib/db/schema";
import { eq, desc, isNull, isNotNull, sum, count, and } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { revalidatePath } from "next/cache";
import { createOrder } from "@/lib/printful";
import { generateOrderName } from "@/lib/ai";
import { getBlankOrThrow, getVariantId } from "@/lib/blanks";
import { assertTransition } from "@/lib/order-state";
import { summarizeLedger } from "@/lib/ledger";
import { ORDER_CLASSIFICATIONS, type OrderClassification } from "@/lib/order-classification";
import { stripe } from "@/lib/stripe";
import { handleStripeCheckoutCompleted, type StripeSessionData } from "@/lib/webhook-handlers";
import { recoverPendingOrderCore } from "@/lib/recover-pending-order";
import { sendPostOrderEmails, createDefaultOrderEmailDeps } from "@/lib/order-emails";
import { sendOrderConfirmation, sendOwnerOrderAlert } from "@/lib/email";
import {
  resolveOrderImageUrls,
  resolveDesignDisplayImageUrls,
  getDesignDisplayImageUrl,
} from "@/lib/design-images";
import { designerAttribution } from "@/lib/order-attribution";

// Second user join (the design's owner) needs an alias to coexist with the
// buyer join on the same query.
const designerUser = alias(userTable, "designer_user");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
if (!ADMIN_EMAIL) {
  throw new Error("ADMIN_EMAIL env var is required");
}

export async function getOrders() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  const rows = await db
    .select({
      id: orderTable.id,
      status: orderTable.status,
      size: orderTable.size,
      color: orderTable.color,
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
      displayName: orderTable.displayName,
      userEmail: userTable.email,
      designId: orderTable.designId,
      placements: orderTable.placements,
    })
    .from(orderTable)
    .leftJoin(userTable, eq(orderTable.userId, userTable.id))
    .orderBy(desc(orderTable.createdAt));

  const displayUrls = await resolveDesignDisplayImageUrls(
    rows.map((r) => r.designId)
  );
  const fallback = new Map<string, string | null>(
    rows.map((r) => [r.designId, displayUrls.get(r.designId) ?? null])
  );
  const resolved = await resolveOrderImageUrls(rows, fallback);
  return rows.map((r) => ({ ...r, designImageUrl: resolved.get(r.id) ?? null }));
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

  // Resolve the design image to print. Prefers the order's pinned
  // placement (placements.front), falls back to the design's primary.
  const designImageUrl = await getDesignDisplayImageUrl(foundOrder.designId);
  if (!designImageUrl) {
    throw new Error("Design has no image");
  }

  const product = getBlankOrThrow(foundOrder.productId ?? "bella-canvas-3001");
  const variantId = getVariantId(product, foundOrder.color, foundOrder.size);
  if (!variantId) {
    throw new Error(`No variant for ${foundOrder.color} ${foundOrder.size} on ${product.name}`);
  }

  const printfulOrder = await createOrder({
    designImageUrl,
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

export type RecoverPendingOrderResult =
  | { ok: true; action: "skipped" | "paid" | "submitted" | "paid_printful_failed" }
  | { ok: false; reason: string };

export async function recoverPendingOrder(
  orderId: string
): Promise<RecoverPendingOrderResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  try {
    const result = await recoverPendingOrderCore(orderId, {
      loadOrder: async (id) => {
        const found = await db.query.order.findFirst({
          where: eq(orderTable.id, id),
          columns: { id: true, status: true, stripeSessionId: true },
        });
        return found ?? null;
      },

      fetchSessionData: async (stripeSessionId) => {
        const fullSession = await stripe.checkout.sessions.retrieve(stripeSessionId, {
          expand: ["total_details.breakdown.discounts.discount"],
        });

        const orderIdMeta = fullSession.metadata?.orderId;
        const designIdMeta = fullSession.metadata?.designId;
        if (!orderIdMeta || !designIdMeta) {
          throw new Error(
            `Stripe session ${stripeSessionId} missing orderId/designId metadata`
          );
        }

        const shipping = fullSession.collected_information?.shipping_details;
        const paymentIntentId =
          typeof fullSession.payment_intent === "string"
            ? fullSession.payment_intent
            : fullSession.payment_intent?.id ?? null;

        // Discount info — same parsing as the live webhook route
        const discountEntry = fullSession.total_details?.breakdown?.discounts?.[0];
        let discount: StripeSessionData["discount"] = null;
        if (discountEntry && discountEntry.amount > 0) {
          const promoCodeId = discountEntry.discount.promotion_code;
          let code = "unknown";
          if (typeof promoCodeId === "string") {
            try {
              const promoCode = await stripe.promotionCodes.retrieve(promoCodeId);
              code = promoCode.code ?? "unknown";
            } catch (err) {
              console.error("Failed to retrieve promotion code during recovery:", err);
            }
          }
          discount = {
            code,
            amount: discountEntry.amount / 100,
          };
        }

        const sessionData: StripeSessionData = {
          id: fullSession.id,
          metadata: { orderId: orderIdMeta, designId: designIdMeta },
          paymentIntentId,
          amountTotal: fullSession.amount_total,
          discount,
          shipping: shipping
            ? {
                name: shipping.name ?? "",
                address1: shipping.address?.line1 ?? "",
                address2: shipping.address?.line2 ?? "",
                city: shipping.address?.city ?? "",
                state: shipping.address?.state ?? "",
                zip: shipping.address?.postal_code ?? "",
                country: shipping.address?.country ?? "US",
              }
            : null,
        };

        return {
          paymentStatus: fullSession.payment_status,
          sessionData,
        };
      },

      runCheckoutHandler: (sessionData) =>
        handleStripeCheckoutCompleted(sessionData, {
          db,
          createPrintfulOrder: createOrder,
          generateOrderName,
          resolveDesignImageUrl: getDesignDisplayImageUrl,
        }),

      sendEmails: (id) =>
        sendPostOrderEmails(
          id,
          createDefaultOrderEmailDeps(db, { sendOrderConfirmation, sendOwnerOrderAlert })
        ),
    });

    return { ok: true, action: result.action };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`recoverPendingOrder(${orderId}) failed:`, err);
    return { ok: false, reason };
  }
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

  const orderConditions = [isNull(orderTable.archivedAt)];
  if (filterClassification) {
    orderConditions.push(eq(orderTable.classification, filterClassification));
  }

  const countRows = await db
    .select({ orderCount: count() })
    .from(orderTable)
    .where(and(...orderConditions));
  const orderCount = countRows[0].orderCount;

  return { ...summarizeLedger(byType), orderCount };
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

export type AdminPublishedImage = {
  imageId: string;
  imageUrl: string;
  title: string | null;
  designerName: string;
  designerEmail: string;
  publishedAt: Date;
  isHidden: boolean;
};

export async function getRecentPublishedForAdmin(
  limit = 100
): Promise<AdminPublishedImage[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  const rows = await db
    .select({
      imageId: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      title: designImageTable.title,
      publishedAt: designImageTable.publishedAt,
      isHidden: designImageTable.isHidden,
      designerName: userTable.name,
      designerEmail: userTable.email,
    })
    .from(designImageTable)
    .innerJoin(designTable, eq(designTable.id, designImageTable.designId))
    .innerJoin(userTable, eq(userTable.id, designTable.userId))
    .where(isNotNull(designImageTable.publishedAt))
    .orderBy(desc(designImageTable.publishedAt))
    .limit(limit);

  return rows.map((r) => ({
    imageId: r.imageId,
    imageUrl: r.imageUrl,
    title: r.title,
    designerName: r.designerName,
    designerEmail: r.designerEmail,
    publishedAt: r.publishedAt!,
    isHidden: r.isHidden,
  }));
}

export async function setImageHidden(imageId: string, hidden: boolean) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  await db
    .update(designImageTable)
    .set({ isHidden: hidden })
    .where(eq(designImageTable.id, imageId));

  // Discover feed on / and the public /d/[imageId] page both filter
  // by isHidden — bust their caches so the change is visible.
  revalidatePath("/");
  revalidatePath(`/d/${imageId}`);
  revalidatePath("/admin/published");
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
        productId: orderTable.productId,
        quality: orderTable.quality,
        totalPrice: orderTable.totalPrice,
        printfulCost: orderTable.printfulCost,
        printfulOrderId: orderTable.printfulOrderId,
        stripeSessionId: orderTable.stripeSessionId,
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
        displayName: orderTable.displayName,
        userEmail: userTable.email,
        designId: orderTable.designId,
        placements: orderTable.placements,
      })
      .from(orderTable)
      .leftJoin(userTable, eq(orderTable.userId, userTable.id))
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

  const displayUrls = await resolveDesignDisplayImageUrls(
    orders.map((r) => r.designId)
  );
  const fallback = new Map<string, string | null>(
    orders.map((r) => [r.designId, displayUrls.get(r.designId) ?? null])
  );
  const resolved = await resolveOrderImageUrls(orders, fallback);
  const ordersWithPinned = orders.map((r) => ({
    ...r,
    designImageUrl: resolved.get(r.id) ?? null,
  }));

  return { orders: ordersWithPinned, ledger };
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
        productId: orderTable.productId,
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
        displayName: orderTable.displayName,
        userEmail: userTable.email,
        buyerId: orderTable.userId,
        designId: orderTable.designId,
        designerId: designTable.userId,
        designerName: designerUser.name,
        placements: orderTable.placements,
      })
      .from(orderTable)
      .leftJoin(userTable, eq(orderTable.userId, userTable.id))
      .leftJoin(designTable, eq(designTable.id, orderTable.designId))
      .leftJoin(designerUser, eq(designerUser.id, designTable.userId))
      .where(eq(orderTable.id, orderId)),
    db.query.ledgerEntry.findMany({
      where: eq(ledgerEntry.orderId, orderId),
      orderBy: (entry, { asc }) => [asc(entry.createdAt)],
    }),
  ]);

  if (orders.length === 0) throw new Error("Order not found");

  const displayUrl = await getDesignDisplayImageUrl(orders[0].designId);
  const fallback = new Map<string, string | null>([
    [orders[0].designId, displayUrl],
  ]);
  const resolved = await resolveOrderImageUrls(orders, fallback);
  const designImageUrl = resolved.get(orders[0].id) ?? null;

  const designedByName = designerAttribution({
    designerId: orders[0].designerId,
    designerName: orders[0].designerName,
    buyerId: orders[0].buyerId,
  });

  return { ...orders[0], designImageUrl, designedByName, ledger };
}
