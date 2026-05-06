"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { order as orderTable } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  resolveOrderImageUrls,
  resolveDesignDisplayImageUrls,
} from "@/lib/design-images";

export async function getUserOrders() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const rows = await db
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
    .where(eq(orderTable.userId, session.user.id))
    .orderBy(desc(orderTable.createdAt));

  // Resolve each order's image via order.placements.front (a
  // design_image snapshot from purchase time) and fall back to the
  // design's current display image for pre-pinning orders.
  const fallback = await resolveDesignDisplayImageUrls(
    rows.map((r) => r.designId)
  );
  const fallbackMap = new Map<string, string | null>(
    rows.map((r) => [r.designId, fallback.get(r.designId) ?? null])
  );
  const resolved = await resolveOrderImageUrls(rows, fallbackMap);

  return rows.map((r) => ({
    ...r,
    designImageUrl: resolved.get(r.id) ?? null,
  }));
}
