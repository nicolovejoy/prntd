import { db } from "@/lib/db";
import {
  order as orderTable,
  orderItem as orderItemTable,
} from "@/lib/db/schema";
import { eq, asc, desc, inArray } from "drizzle-orm";
import { resolveOrderLines } from "@/lib/order-lines";
import { contributorAttribution } from "@/lib/order-attribution";
import { resolveOrderLineIdentities } from "@/lib/order-line-identity";

export type UserOrder = Awaited<ReturnType<typeof getUserOrdersData>>[number];

/**
 * The /orders history for one buyer. Query core shared by the server
 * component render (initial data) — auth lives at the caller.
 */
export async function getUserOrdersData(buyerId: string) {
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
    .where(eq(orderTable.userId, buyerId))
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
