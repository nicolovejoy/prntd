/**
 * Shop feed query + ordering.
 *
 * The feed (homepage grid + /prints) lists published, non-hidden images,
 * one card per design. Position is admin-controlled via `product.feed_rank`
 * (/admin/published): ranked images list first, lowest rank first; unranked
 * images follow, newest published first — exactly the pre-rank behavior.
 *
 * Composition slice 2: the sellable fields come off the image's mirror
 * `product` row (docs/composition-first-class-plan.md §1 "job A"), not its
 * `listing` row. See src/lib/composition-reads.ts.
 */
import { db } from "@/lib/db";
import {
  image as imageTable,
  product as productTable,
  user as userTable,
} from "@/lib/db/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import {
  isShopMirror,
  listedMirrorPublishedAt,
  mirrorFrontImageId,
} from "@/lib/composition-reads";

export type FeedRow = {
  imageId: string;
  designId: string;
  imageUrl: string;
  title: string | null;
  description: string | null;
  backgroundColor: string | null;
  publishedAt: Date;
  feedRank: number | null;
  designerName: string;
  designerId: string;
};

/**
 * Feed comparator: ranked before unranked, rank ascending; ties (equal
 * rank, or both unranked) fall back to newest published first.
 */
export function compareFeedOrder(
  a: { publishedAt: Date; feedRank: number | null },
  b: { publishedAt: Date; feedRank: number | null }
): number {
  if (a.feedRank !== null && b.feedRank !== null && a.feedRank !== b.feedRank) {
    return a.feedRank - b.feedRank;
  }
  if (a.feedRank !== null && b.feedRank === null) return -1;
  if (a.feedRank === null && b.feedRank !== null) return 1;
  return b.publishedAt.getTime() - a.publishedAt.getTime();
}

/**
 * Collapse to one card per design, then sort by compareFeedOrder.
 * Publishing happens per image, so a design can have several published
 * rows; the design's representative is its best row by the same
 * comparator — a ranked image wins over a newer unranked sibling, so the
 * admin's pick is the card that shows. Order-independent input.
 */
export function orderFeedByRank<
  T extends { designId: string; publishedAt: Date; feedRank: number | null },
>(rows: T[]): T[] {
  const byDesign = new Map<string, T>();
  for (const row of rows) {
    const existing = byDesign.get(row.designId);
    if (!existing || compareFeedOrder(row, existing) < 0) {
      byDesign.set(row.designId, row);
    }
  }
  return [...byDesign.values()].sort(compareFeedOrder);
}

/**
 * The feed rows getDiscoverFeed serves. Over-fetches (a design can have
 * several published images), collapses to one row per design, then slices
 * to the requested limit. The SQL orderBy mirrors compareFeedOrder so
 * ranked rows are never cut off by the over-fetch window.
 */
export async function getPublishedFeed(limit = 60): Promise<FeedRow[]> {
  // Composition slice 2: the feed is a *product* query. A Shop mirror row
  // exists iff the image is published, and `status = "listed"` is exactly the
  // old `is_hidden = false` (hidden → status "hidden", unpublished → "draft"),
  // so the same rows come back. The image joins on the mirror's front
  // placement slot; the designer comes off image.ownerId (denormalized in
  // Model B) — no design join left.
  const rows = await db
    .select({
      imageId: imageTable.id,
      designId: imageTable.sourceDesignId,
      imageUrl: imageTable.imageUrl,
      title: productTable.title,
      description: productTable.description,
      backgroundColor: productTable.backdropColor,
      listedAt: productTable.listedAt,
      productCreatedAt: productTable.createdAt,
      feedRank: productTable.feedRank,
      designerName: userTable.name,
      designerId: userTable.id,
    })
    .from(productTable)
    .innerJoin(imageTable, eq(mirrorFrontImageId, imageTable.id))
    .innerJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .where(and(isShopMirror(), eq(productTable.status, "listed")))
    .orderBy(
      sql`${productTable.feedRank} is null`,
      asc(productTable.feedRank),
      desc(productTable.listedAt)
    )
    .limit(Math.min(limit * 4, 240));

  // An image with no source conversation is its own dedupe group.
  // The publish timestamp goes through the shared rule so the feed, /d, the
  // admin grid and the share card can never disagree about it.
  return orderFeedByRank(
    rows.map(({ listedAt, productCreatedAt, ...r }) => ({
      ...r,
      designId: r.designId ?? r.imageId,
      publishedAt: listedMirrorPublishedAt(listedAt, productCreatedAt),
    }))
  ).slice(0, limit);
}
