import { db } from "@/lib/db";
import {
  order as orderTable,
  orderItem as orderItemTable,
  design as designTable,
  user as userTable,
} from "@/lib/db/schema";
import { eq, asc, desc, inArray } from "drizzle-orm";
import {
  resolveDesignDisplayImageUrls,
  resolveImagesByIds,
} from "@/lib/design-images";
import { resolveOrderLines } from "@/lib/order-lines";
import {
  contributorAttribution,
  placementImageIds,
  resolveContributors,
} from "@/lib/order-attribution";
import { loadImageOwners } from "@/lib/order-line-identity";

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

  // Batch-resolve per-line thumbnails + contributor attribution (no N+1).
  const lineDesignIds = [
    ...new Set(withLines.flatMap((w) => w.lines.map((l) => l.designId))),
  ];
  const pinnedImageIds = [
    ...new Set(
      withLines.flatMap((w) =>
        w.lines
          .map((l) => l.placements.front)
          .filter((v): v is string => Boolean(v))
      )
    ),
  ];
  // Every placement image, not just the front: a back drawn by someone else
  // makes that person a contributor too (composition plan §3).
  const allPlacementImageIds = [
    ...new Set(
      withLines.flatMap((w) => w.lines.flatMap((l) => placementImageIds(l.placements)))
    ),
  ];

  // Prefer each line's pinned `placements.front` (a design_image snapshot from
  // purchase time) over the design's current display image, so historical
  // orders keep showing what was actually printed. The four lookups are
  // independent — one round of parallel queries.
  const [fallbackUrls, pinnedById, ownerByImageId, designerRows] = await Promise.all([
    resolveDesignDisplayImageUrls(lineDesignIds),
    resolveImagesByIds(pinnedImageIds),
    loadImageOwners(db, allPlacementImageIds),
    lineDesignIds.length
      ? db
          .select({
            designId: designTable.id,
            designerId: designTable.userId,
            designerName: userTable.name,
          })
          .from(designTable)
          .leftJoin(userTable, eq(userTable.id, designTable.userId))
          .where(inArray(designTable.id, lineDesignIds))
      : Promise.resolve([]),
  ]);
  const pinnedUrlById = new Map(
    [...pinnedById].map(([id, img]) => [id, img.imageUrl])
  );
  const designerByDesign = new Map(designerRows.map((r) => [r.designId, r]));

  return withLines.map(({ order, lines }) => ({
    id: order.id,
    status: order.status,
    totalPrice: order.totalPrice,
    trackingNumber: order.trackingNumber,
    trackingUrl: order.trackingUrl,
    createdAt: order.createdAt,
    archivedAt: order.archivedAt,
    displayName: order.displayName,
    lines: lines.map((l) => {
      const front = l.placements.front;
      const imageUrl =
        (front ? pinnedUrlById.get(front) : undefined) ??
        fallbackUrls.get(l.designId) ??
        null;
      const legacyOwner = designerByDesign.get(l.designId);
      return {
        designId: l.designId,
        blankId: l.blankId,
        size: l.size,
        color: l.color,
        quantity: l.quantity,
        imageUrl,
        // Legacy lines (no placements JSON, or a pin that isn't an artifact)
        // fall back to the conversation's owner so historical orders keep the
        // attribution they have always shown.
        designedByName: contributorAttribution({
          contributors: resolveContributors({
            placements: l.placements,
            ownerByImageId,
            fallback: legacyOwner
              ? { userId: legacyOwner.designerId, name: legacyOwner.designerName }
              : null,
          }),
          viewerId: buyerId,
        }),
      };
    }),
  }));
}
