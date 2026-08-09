"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  order as orderTable,
  orderItem as orderItemTable,
  design as designTable,
  image as imageTable,
  listing as listingTable,
  user as userTable,
  ledgerEntry,
  appError as appErrorTable,
} from "@/lib/db/schema";
import { listingSyncStatement } from "@/lib/model-b-writes";
import { eq, desc, asc, inArray, sum, count, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { revalidatePath } from "next/cache";
import { createOrder, getOrderByExternalId } from "@/lib/printful";
import { generateOrderName } from "@/lib/ai";
import { assertTransition, canArchiveOrder } from "@/lib/order-state";
import { summarizeLedger } from "@/lib/ledger";
import { ORDER_CLASSIFICATIONS, type OrderClassification } from "@/lib/order-classification";
import { stripe } from "@/lib/stripe";
import { handleStripeCheckoutCompleted } from "@/lib/webhook-handlers";
import { submitOrderFulfillment } from "@/lib/order-fulfillment";
import { toStripeSessionData } from "@/lib/stripe-session";
import { resolveOrderLines } from "@/lib/order-lines";
import { recoverPendingOrderCore } from "@/lib/recover-pending-order";
import { refundOrderCore, type RefundOrderResult } from "@/lib/refund-order";
import { sendPostOrderEmails, createDefaultOrderEmailDeps } from "@/lib/order-emails";
import { sendOrderConfirmation, sendOwnerOrderAlert } from "@/lib/email";
import {
  resolveOrderImageUrls,
  resolveDesignDisplayImageUrls,
  getDesignDisplayImageUrl,
  getDesignImageById,
} from "@/lib/design-images";
import { designerAttribution } from "@/lib/order-attribution";
import { resolveOrderLineIdentities } from "@/lib/order-line-identity";
import { isAdminEmail } from "@/lib/admin";

// Second user join (the design's owner) needs an alias to coexist with the
// buyer join on the same query.
const designerUser = alias(userTable, "designer_user");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
if (!ADMIN_EMAIL) {
  throw new Error("ADMIN_EMAIL env var is required");
}

/**
 * Whether the current session belongs to the admin. Client-readable (drives
 * the nav's Admin entry) — returns only a boolean, never the admin email.
 */
export async function isAdminUser(): Promise<boolean> {
  const session = await auth.api.getSession({ headers: await headers() });
  return isAdminEmail(session?.user?.email, ADMIN_EMAIL);
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

  // Delegate to the same fulfillment tail the Stripe webhook uses, so the
  // retry handles multi-item orders, pinned placements (front + back), and
  // COGS exactly like a fresh payment would.
  const items = await db.query.orderItem.findMany({
    where: eq(orderItemTable.orderId, orderId),
  });
  const result = await submitOrderFulfillment(
    foundOrder,
    items,
    {
      name: foundOrder.shippingName ?? "",
      address1: foundOrder.shippingAddress1 ?? "",
      address2: foundOrder.shippingAddress2 ?? "",
      city: foundOrder.shippingCity ?? "",
      state: foundOrder.shippingState ?? "",
      zip: foundOrder.shippingZip ?? "",
      country: foundOrder.shippingCountry ?? "US",
    },
    {
      db,
      createPrintfulOrder: createOrder,
      getPrintfulOrderByExternalId: getOrderByExternalId,
      generateOrderName,
      resolveDesignImageUrl: getDesignDisplayImageUrl,
      resolveImageUrlById: async (imageId) =>
        (await getDesignImageById(imageId))?.imageUrl ?? null,
    }
  );

  if (result.action !== "submitted") {
    throw new Error(
      result.action === "paid"
        ? "No fulfillable lines on this order (missing images or variants) — see logs"
        : "Printful submission failed — see logs"
    );
  }

  return { printfulOrderId: result.printfulOrderId };
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

        // Same translation as the live webhook route — one function, no drift.
        const sessionData = await toStripeSessionData(fullSession, {
          retrievePromotionCode: async (id) =>
            (await stripe.promotionCodes.retrieve(id)).code ?? null,
        });

        return {
          paymentStatus: fullSession.payment_status,
          sessionData,
        };
      },

      runCheckoutHandler: (sessionData) =>
        handleStripeCheckoutCompleted(sessionData, {
          db,
          createPrintfulOrder: createOrder,
          getPrintfulOrderByExternalId: getOrderByExternalId,
          generateOrderName,
          resolveDesignImageUrl: getDesignDisplayImageUrl,
          resolveImageUrlById: async (imageId) =>
            (await getDesignImageById(imageId))?.imageUrl ?? null,
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

/**
 * Refund a canceled order's customer (finding #1). Admin-clicked only — a
 * Printful cancel never auto-refunds. Idempotent: a second click is a no-op
 * (see refundOrderCore). Returns a result object rather than throwing so the UI
 * can show why a refund was skipped (already refunded, not canceled, $0, etc.).
 */
export async function refundOrder(orderId: string): Promise<RefundOrderResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  const result = await refundOrderCore(orderId, {
    db,
    retrievePaymentIntentId: async (stripeSessionId) => {
      const s = await stripe.checkout.sessions.retrieve(stripeSessionId);
      return typeof s.payment_intent === "string"
        ? s.payment_intent
        : s.payment_intent?.id ?? null;
    },
    createRefund: async (paymentIntentId, idempotencyKey) => {
      await stripe.refunds.create(
        { payment_intent: paymentIntentId },
        { idempotencyKey }
      );
    },
  });

  if (result.ok) revalidatePath(`/admin/orders/${orderId}`);
  return result;
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
  if (!canArchiveOrder(found)) {
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

  // Archival is a display/workflow state, never a financial one — an
  // archived order's ledger rows already count above, so orderCount must
  // include it too or the summary's own numbers disagree with each other.
  const countRows = filterClassification
    ? await db
        .select({ orderCount: count() })
        .from(orderTable)
        .where(eq(orderTable.classification, filterClassification))
    : await db.select({ orderCount: count() }).from(orderTable);
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
  feedRank: number | null;
};

export async function getRecentPublishedForAdmin(
  limit = 100
): Promise<AdminPublishedImage[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  // Same order as the Shop feed (ranked first, then newest) so the admin
  // grid mirrors what customers see.
  // Published = has a listing row (Model B); hidden ones stay in the grid so
  // the admin can unhide them.
  const rows = await db
    .select({
      imageId: imageTable.id,
      imageUrl: imageTable.imageUrl,
      title: listingTable.title,
      publishedAt: listingTable.publishedAt,
      isHidden: listingTable.isHidden,
      feedRank: listingTable.feedRank,
      designerName: userTable.name,
      designerEmail: userTable.email,
    })
    .from(listingTable)
    .innerJoin(imageTable, eq(imageTable.id, listingTable.imageId))
    .innerJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .orderBy(
      sql`${listingTable.feedRank} is null`,
      asc(listingTable.feedRank),
      desc(listingTable.publishedAt)
    )
    .limit(limit);

  return rows.map((r) => ({
    imageId: r.imageId,
    imageUrl: r.imageUrl,
    title: r.title,
    designerName: r.designerName,
    designerEmail: r.designerEmail,
    publishedAt: r.publishedAt,
    isHidden: r.isHidden,
    feedRank: r.feedRank,
  }));
}

/**
 * Set (or clear, with null) an image's Shop feed rank. Lower ranks list
 * first; unranked images follow in recency order. Ranks need not be
 * contiguous or unique — equal ranks fall back to recency.
 */
export async function setImageFeedRank(
  imageId: string,
  feedRank: number | null
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  if (
    feedRank !== null &&
    (!Number.isInteger(feedRank) || feedRank < 1 || feedRank > 9999)
  ) {
    throw new Error("Rank must be a whole number between 1 and 9999");
  }

  // Slice-4 cutover: rank lives only on the listing (no-op if unpublished).
  await listingSyncStatement(db, imageId, { kind: "update", set: { feedRank } });

  // The Shop feed renders on / and /prints; bust both plus the admin grid.
  revalidatePath("/");
  revalidatePath("/prints");
  revalidatePath("/admin/published");
}

export async function setImageHidden(imageId: string, hidden: boolean) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  // Slice-4 cutover: moderation state lives only on the listing (no-op if
  // unpublished — hidden is a feed concept, and unpublished images aren't in it).
  await listingSyncStatement(db, imageId, {
    kind: "update",
    set: { isHidden: hidden },
  });

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

  // Purchased lines for every order in one query (order_item is authoritative
  // since Phase 1c) — the list's thumbnail backdrop and size/color column read
  // the first line instead of the dropped scalar columns.
  const orderIds = orders.map((r) => r.id);
  const itemRows = orderIds.length
    ? await db
        .select()
        .from(orderItemTable)
        .where(inArray(orderItemTable.orderId, orderIds))
        .orderBy(asc(orderItemTable.createdAt))
    : [];
  const linesByOrder = new Map<string, typeof itemRows>();
  for (const it of itemRows) {
    const list = linesByOrder.get(it.orderId) ?? [];
    list.push(it);
    linesByOrder.set(it.orderId, list);
  }

  const ordersWithLines = orders.map((r) => ({
    ...r,
    lines: resolveOrderLines(linesByOrder.get(r.id) ?? []),
  }));

  const displayUrls = await resolveDesignDisplayImageUrls(
    orders.map((r) => r.designId)
  );
  const fallback = new Map<string, string | null>(
    orders.map((r) => [r.designId, displayUrls.get(r.designId) ?? null])
  );
  const resolved = await resolveOrderImageUrls(
    ordersWithLines.map((r) => ({
      id: r.id,
      designId: r.designId,
      placements: r.lines[0]?.placements ?? null,
    })),
    fallback
  );
  const ordersWithPinned = ordersWithLines.map((r) => ({
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
        quality: orderTable.quality,
        totalPrice: orderTable.totalPrice,
        itemPrice: orderTable.itemPrice,
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

  // Every purchased line (order_item is authoritative since Phase 1c).
  const items = await db.query.orderItem.findMany({
    where: eq(orderItemTable.orderId, orderId),
    orderBy: (fields, { asc }) => [asc(fields.createdAt)],
  });
  const baseLines = resolveOrderLines(items);

  // Per-line identity: a cart order's lines can each carry a different
  // design, so thumbnail + attribution are resolved per line rather than
  // once off the order header.
  const identities = await resolveOrderLineIdentities(db, baseLines);
  const lines = baseLines.map((line, i) => ({
    ...line,
    imageUrl: identities[i]?.imageUrl ?? null,
    title: identities[i]?.title ?? null,
    designedByName: designerAttribution({
      designerId: identities[i]?.designerId ?? null,
      designerName: identities[i]?.designerName ?? null,
      buyerId: orders[0].buyerId,
    }),
  }));

  const displayUrl = await getDesignDisplayImageUrl(orders[0].designId);
  const fallback = new Map<string, string | null>([
    [orders[0].designId, displayUrl],
  ]);
  const resolved = await resolveOrderImageUrls(
    [
      {
        id: orders[0].id,
        designId: orders[0].designId,
        placements: lines[0]?.placements ?? null,
      },
    ],
    fallback
  );
  const designImageUrl = resolved.get(orders[0].id) ?? null;

  const designedByName = designerAttribution({
    designerId: orders[0].designerId,
    designerName: orders[0].designerName,
    buyerId: orders[0].buyerId,
  });

  return { ...orders[0], designImageUrl, designedByName, lines, ledger };
}

export type AdminAppError = {
  id: string;
  createdAt: Date;
  digest: string | null;
  message: string;
  stack: string | null;
  path: string | null;
  method: string | null;
  context: Record<string, string> | null;
};

/** Last N runtime errors recorded by instrumentation.ts (#121), newest first. */
export async function getRecentAppErrors(limit = 50): Promise<AdminAppError[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  return db
    .select()
    .from(appErrorTable)
    .orderBy(desc(appErrorTable.createdAt))
    .limit(limit);
}
