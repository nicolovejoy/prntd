"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  order as orderTable,
  orderItem as orderItemTable,
  design as designTable,
  designImage as designImageTable,
  user as userTable,
} from "@/lib/db/schema";
import { eq, asc, desc, inArray } from "drizzle-orm";
import { resolveDesignDisplayImageUrls } from "@/lib/design-images";
import { resolveOrderLines } from "@/lib/order-lines";
import { designerAttribution } from "@/lib/order-attribution";

export async function getUserOrders() {
  const session = await auth.api.getSession({ headers: await headers() });
  // Personal page — anonymous guests (#26) must sign in to see their orders.
  if (!session || isAnonymousUser(session.user)) throw new Error("Unauthorized");
  const buyerId = session.user.id;

  const orders = await db
    .select({
      id: orderTable.id,
      designId: orderTable.designId,
      placements: orderTable.placements,
      status: orderTable.status,
      size: orderTable.size,
      color: orderTable.color,
      productId: orderTable.productId,
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

  // Each order's purchased items. Cart orders (#26) carry one order_item row
  // per shirt; legacy single-item orders carry none and fall back to the
  // scalar columns on `order`. resolveOrderLines normalizes both into lines so
  // a multi-item order shows every shirt instead of just the first.
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
      {
        designId: o.designId,
        productId: o.productId,
        size: o.size,
        color: o.color,
        placements: o.placements,
        itemPrice: null,
        printfulCost: null,
      },
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

  // Batch-resolve per-line thumbnails + designer attribution (no N+1).
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

  // Prefer each line's pinned `placements.front` (a design_image snapshot from
  // purchase time) over the design's current display image, so historical
  // orders keep showing what was actually printed.
  const fallbackUrls = await resolveDesignDisplayImageUrls(lineDesignIds);
  const pinnedRows = pinnedImageIds.length
    ? await db
        .select({ id: designImageTable.id, imageUrl: designImageTable.imageUrl })
        .from(designImageTable)
        .where(inArray(designImageTable.id, pinnedImageIds))
    : [];
  const pinnedUrlById = new Map(pinnedRows.map((r) => [r.id, r.imageUrl]));

  const designerRows = lineDesignIds.length
    ? await db
        .select({
          designId: designTable.id,
          designerId: designTable.userId,
          designerName: userTable.name,
        })
        .from(designTable)
        .leftJoin(userTable, eq(userTable.id, designTable.userId))
        .where(inArray(designTable.id, lineDesignIds))
    : [];
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
      const designer = designerByDesign.get(l.designId);
      return {
        designId: l.designId,
        blankId: l.blankId,
        size: l.size,
        color: l.color,
        quantity: l.quantity,
        imageUrl,
        designedByName: designer
          ? designerAttribution({
              designerId: designer.designerId,
              designerName: designer.designerName,
              buyerId,
            })
          : null,
      };
    }),
  }));
}
