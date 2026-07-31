import { db } from "@/lib/db";
import {
  design as designTable,
  listing as listingTable,
} from "@/lib/db/schema";
import { eq, desc, and, not, inArray } from "drizzle-orm";
import { resolveDesignDisplayImageUrls } from "@/lib/design-images";

export type UserDesign = Awaited<ReturnType<typeof getUserDesignsData>>[number];

/**
 * The /designs card list for one user. Query core shared by the server
 * component render (initial data) — auth lives at the caller.
 */
export async function getUserDesignsData(userId: string) {
  const designs = await db.query.design.findMany({
    where: and(
      eq(designTable.userId, userId),
      not(eq(designTable.status, "archived"))
    ),
    orderBy: desc(designTable.updatedAt),
    columns: {
      id: true,
      status: true,
      generationCount: true,
      primaryImageId: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const primaryIds = designs
    .map((d) => d.primaryImageId)
    .filter((id): id is string => id !== null);

  // Thumbnails and publish state are independent — fetch both at once.
  const [imageUrls, primaryById] = await Promise.all([
    resolveDesignDisplayImageUrls(designs.map((d) => d.id)),
    loadPublishState(primaryIds),
  ]);

  return designs.map((d) => {
    const primary = d.primaryImageId
      ? primaryById.get(d.primaryImageId)
      : undefined;
    return {
      ...d,
      imageUrl: imageUrls.get(d.id) ?? null,
      primaryImagePublishedAt: primary?.publishedAt ?? null,
      primaryImageBackgroundColor: primary?.backgroundColor ?? null,
    };
  });
}

/**
 * Publish state (+ chosen storefront backdrop) for each primary image so the
 * cards can show Publish vs Published correctly and render published designs
 * over their backdrop color. Best-effort: if this query fails the cards just
 * hide the publish badge — the design list itself must still render.
 */
async function loadPublishState(
  primaryIds: string[]
): Promise<
  Map<string, { publishedAt: Date | null; backgroundColor: string | null }>
> {
  if (primaryIds.length === 0) return new Map();
  try {
    // Publish state lives in `listing` — a row exists iff published, so an
    // unpublished primary is simply absent from the map.
    const primaryRows = await db
      .select({
        id: listingTable.imageId,
        publishedAt: listingTable.publishedAt,
        backgroundColor: listingTable.backgroundColor,
      })
      .from(listingTable)
      .where(inArray(listingTable.imageId, primaryIds));
    return new Map(
      primaryRows.map((r) => [
        r.id,
        { publishedAt: r.publishedAt, backgroundColor: r.backgroundColor },
      ])
    );
  } catch (err) {
    console.error("getUserDesignsData: publish-state lookup failed", err);
    return new Map();
  }
}
