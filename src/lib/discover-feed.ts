/**
 * Shop feed query + ordering.
 *
 * The feed (homepage grid + /prints) lists published, non-hidden images,
 * one card per design. Position is admin-controlled via
 * `design_image.feed_rank` (/admin/published): ranked images list first,
 * lowest rank first; unranked images follow, newest published first —
 * exactly the pre-rank behavior.
 */
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  user as userTable,
} from "@/lib/db/schema";
import { eq, and, isNotNull, desc, asc, sql } from "drizzle-orm";

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
  const rows = await db
    .select({
      imageId: designImageTable.id,
      designId: designImageTable.designId,
      imageUrl: designImageTable.imageUrl,
      title: designImageTable.title,
      description: designImageTable.description,
      backgroundColor: designImageTable.backgroundColor,
      publishedAt: designImageTable.publishedAt,
      feedRank: designImageTable.feedRank,
      designerName: userTable.name,
      designerId: userTable.id,
    })
    .from(designImageTable)
    .innerJoin(designTable, eq(designTable.id, designImageTable.designId))
    .innerJoin(userTable, eq(userTable.id, designTable.userId))
    .where(
      and(
        isNotNull(designImageTable.publishedAt),
        eq(designImageTable.isHidden, false)
      )
    )
    .orderBy(
      sql`${designImageTable.feedRank} is null`,
      asc(designImageTable.feedRank),
      desc(designImageTable.publishedAt)
    )
    .limit(Math.min(limit * 4, 240));

  return orderFeedByRank(
    rows.map((r) => ({ ...r, publishedAt: r.publishedAt! }))
  ).slice(0, limit);
}
