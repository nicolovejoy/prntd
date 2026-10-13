/**
 * Shop feed query + ordering.
 *
 * The feed (homepage grid + /shop) lists published, non-hidden images,
 * one card per design. Position is admin-controlled via `product.feed_rank`
 * (/admin/published): ranked images list first, lowest rank first; unranked
 * images follow, newest published first — exactly the pre-rank behavior.
 *
 * Composition slice 2: the sellable fields come off the image's `product`
 * composition (docs/composition-first-class-plan.md §1 "job A"), not its
 * visibility row. See src/lib/composition-reads.ts. Whether an image is shown
 * at all is read from `image_publication` (#300), like every other visibility
 * check; `product.status` is not consulted.
 *
 * A listing also needs a live conversation (#321): the image's conversation id
 * (`image.source_design_id`, else the design of its `output` link, the id
 * `getDesignImageWithOwner` derives) must name an existing `design` row, which
 * is the condition under which `resolveBuyableImage` lets a signed-out visitor
 * order it. A published image can outlive its conversation; its card would
 * lead to a page with no Order, so the feed leaves it out. That conversation
 * id is also the dedupe key.
 *
 * src/lib/feed-visibility-parity.ts re-runs this query's joins as raw SQL so
 * a production database can be checked against the visibility rule, and lists
 * the visible listings this rule leaves out. If the joins or the filters below
 * change, change that module with them.
 */
import { db } from "@/lib/db";
import {
  conversationImage as conversationImageTable,
  design as designTable,
  image as imageTable,
  imagePublication as imagePublicationTable,
  product as productTable,
  user as userTable,
} from "@/lib/db/schema";
import { eq, desc, asc, sql } from "drizzle-orm";
import {
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
  /**
   * The garment this composition fixes, or null when the buyer picks one.
   * Null on every Shop mirror today (model-b-writes.ts writes blankId: null);
   * the field exists because the Shop card names the garment it prices.
   */
  blankId: string | null;
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
  // The feed is a *product* query. Every product row is a Shop composition
  // (slice 5 dropped the organizer population), and the image joins on the
  // composition's front placement slot. Whether that image is public is
  // `image_publication`'s to say, as for every other visibility check (#300):
  // the inner join drops an image with no publication row (unpublished) and
  // `is_hidden = false` drops one an admin hid. `product.status` is still
  // written on publish, unpublish and hide but is not read here. The designer
  // comes off image.ownerId (denormalized in Model B).
  //
  // The inner join on `design` keeps a listing only when its conversation id
  // names a live conversation (see the header). It is a primary-key join, so
  // it cannot multiply rows, and it sits in the same query before the limit,
  // so a dropped row never takes a slot from one that should show. The output
  // link is a scalar subquery rather than a join for the same reason.
  const conversationId = sql<string>`coalesce(${imageTable.sourceDesignId}, (select ${conversationImageTable.designId} from ${conversationImageTable} where ${conversationImageTable.imageId} = ${imageTable.id} and ${conversationImageTable.role} = 'output' limit 1))`;
  const rows = await db
    .select({
      imageId: imageTable.id,
      designId: designTable.id,
      imageUrl: imageTable.imageUrl,
      title: productTable.title,
      description: productTable.description,
      backgroundColor: productTable.backdropColor,
      blankId: productTable.blankId,
      listedAt: productTable.listedAt,
      productCreatedAt: productTable.createdAt,
      feedRank: productTable.feedRank,
      designerName: userTable.name,
      designerId: userTable.id,
    })
    .from(productTable)
    .innerJoin(imageTable, eq(mirrorFrontImageId, imageTable.id))
    .innerJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .innerJoin(
      imagePublicationTable,
      eq(imagePublicationTable.imageId, imageTable.id)
    )
    .innerJoin(designTable, eq(designTable.id, conversationId))
    .where(eq(imagePublicationTable.isHidden, false))
    .orderBy(
      sql`${productTable.feedRank} is null`,
      asc(productTable.feedRank),
      desc(productTable.listedAt)
    )
    .limit(Math.min(limit * 4, 240));

  // Every row has a live conversation (the join above), so designId is never
  // null and there is no per-image fallback group. The publish timestamp goes through the shared rule so the feed, /d, the
  // admin grid and the share card can never disagree about it.
  return orderFeedByRank(
    rows.map(({ listedAt, productCreatedAt, ...r }) => ({
      ...r,
      publishedAt: listedMirrorPublishedAt(listedAt, productCreatedAt),
    }))
  ).slice(0, limit);
}
