import { db } from "@/lib/db";
import {
  order as orderTable,
  orderItem as orderItemTable,
} from "@/lib/db/schema";
import { and, eq, ne, or, isNull, isNotNull, lt, asc, desc, inArray } from "drizzle-orm";
import { resolveOrderLines } from "@/lib/order-lines";
import { contributorAttribution } from "@/lib/order-attribution";
import { resolveOrderLineIdentities } from "@/lib/order-line-identity";

export type UserOrder = Awaited<ReturnType<typeof getUserOrdersData>>[number];

// Stripe Checkout Sessions expire CHECKOUT_SESSION_TTL_SECONDS (2h,
// src/lib/checkout.ts) after creation, at which point the
// checkout.session.expired webhook sets order.abandonedAt. This window sits
// 15 minutes above that TTL — margin for webhook-delivery lag, so a pending
// row that is merely mid-flight (session not yet expired, webhook not yet
// fired) doesn't get misread as webhook-stranded below.
export const STALE_PENDING_MS = 135 * 60 * 1000;

/**
 * The /orders history for one buyer. Query core shared by the server
 * component render (initial data) — auth lives at the caller. `now` is
 * injected so tests can pin the pending-order age window deterministically.
 */
export async function getUserOrdersData(buyerId: string, now = Date.now()) {
  const orders = await db
    .select({
      id: orderTable.id,
      designId: orderTable.designId,
      status: orderTable.status,
      totalPrice: orderTable.totalPrice,
      trackingNumber: orderTable.trackingNumber,
      trackingUrl: orderTable.trackingUrl,
      createdAt: orderTable.createdAt,
      archivedAt: orderTable.archivedAt,
      displayName: orderTable.displayName,
    })
    .from(orderTable)
    // pending covers four populations: young (in-flight or not-yet-expired
    // checkout — hidden, it may still complete), abandoned (Stripe's
    // checkout.session.expired webhook confirmed the session died — hidden),
    // old-and-not-abandoned-with-a-session (the checkout session expired or
    // is long past its TTL but no completed/expired webhook ever landed — a
    // paid order the webhook never recorded, or an expiry Stripe never told
    // us about; shown as "Processing" so the buyer has a record, and admin's
    // Recover control fixes it), and session-less (stripeSessionId never got
    // backfilled — checkout.ts inserts the order row before creating the
    // Stripe session, so a session-create failure, or any pre-#231 legacy
    // row scripts/mark-legacy-pending-abandoned.ts hasn't reached, leaves
    // this null forever; a row that never had a session could never have
    // been paid, so it's hidden regardless of age or abandonedAt).
    .where(
      and(
        eq(orderTable.userId, buyerId),
        or(
          ne(orderTable.status, "pending"),
          and(
            isNotNull(orderTable.stripeSessionId),
            isNull(orderTable.abandonedAt),
            lt(orderTable.createdAt, new Date(now - STALE_PENDING_MS))
          )
        )
      )
    )
    .orderBy(desc(orderTable.createdAt));

  // Each order's purchased items — one order_item row per shirt (authoritative
  // since Phase 1c), so a multi-item order shows every shirt, not just the first.
  const orderIds = orders.map((o) => o.id);
  const itemRows = orderIds.length
    ? await db
        .select({
          orderId: orderItemTable.orderId,
          designId: orderItemTable.designId,
          productId: orderItemTable.productId,
          size: orderItemTable.size,
          color: orderItemTable.color,
          quantity: orderItemTable.quantity,
          placements: orderItemTable.placements,
        })
        .from(orderItemTable)
        .where(inArray(orderItemTable.orderId, orderIds))
        .orderBy(asc(orderItemTable.createdAt))
    : [];
  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const it of itemRows) {
    const list = itemsByOrder.get(it.orderId) ?? [];
    list.push(it);
    itemsByOrder.set(it.orderId, list);
  }

  const withLines = orders.map((o) => ({
    order: o,
    lines: resolveOrderLines(
      (itemsByOrder.get(o.id) ?? []).map((it) => ({
        designId: it.designId,
        productId: it.productId,
        size: it.size,
        color: it.color,
        quantity: it.quantity,
        placements: it.placements,
        itemPrice: null,
        printfulCost: null,
      }))
    ),
  }));

  // Each order's starting index into the flat identities array below,
  // assigned in the same pass that flattens `withLines` into `allLines`.
  // An order carries its own offset rather than a shared counter advanced
  // while pairing results back afterward — a zero-line order just contributes
  // an offset nothing reads, instead of relying on a side effect not firing.
  let runningOffset = 0;
  const withOffsets = withLines.map((w) => {
    const offset = runningOffset;
    runningOffset += w.lines.length;
    return { ...w, offset };
  });

  // Thumbnail + back image + contributor attribution, batched once for every
  // line across every order (never N+1) via the shared identity mapper —
  // the same rules the confirmation page and admin order detail use.
  const allLines = withOffsets.flatMap((w) => w.lines);
  const identities = await resolveOrderLineIdentities(
    db,
    allLines.map((l) => ({ designId: l.designId, placements: l.placements }))
  );

  return withOffsets.map(({ order, lines, offset }) => ({
    id: order.id,
    status: order.status,
    totalPrice: order.totalPrice,
    trackingNumber: order.trackingNumber,
    trackingUrl: order.trackingUrl,
    createdAt: order.createdAt,
    archivedAt: order.archivedAt,
    displayName: order.displayName,
    lines: lines.map((l, i) => {
      const identity = identities[offset + i];
      return {
        designId: l.designId,
        blankId: l.blankId,
        size: l.size,
        color: l.color,
        quantity: l.quantity,
        imageUrl: identity.imageUrl,
        backImageUrl: identity.backImageUrl,
        designedByName: contributorAttribution({
          contributors: identity.contributors,
          viewerId: buyerId,
        }),
      };
    }),
  }));
}
