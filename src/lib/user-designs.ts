import { db } from "@/lib/db";
import {
  design as designTable,
  image as imageTable,
  listing as listingTable,
  product as productTable,
} from "@/lib/db/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import {
  isPublishedShopMirror,
  mirrorFrontImageId,
} from "@/lib/composition-reads";
import { sweepStaleJobs } from "@/lib/generation-job";

/** One cell in the My Designs grid. */
export type LibraryImage = {
  imageId: string;
  imageUrl: string;
  createdAt: Date;
  /** A listing row exists — the image is on the storefront. */
  isPublished: boolean;
  /** Pinned storefront backdrop, null for unpublished work (#73). */
  backgroundColor: string | null;
  /** The conversation that produced it; null for legacy rows. */
  sourceDesignId: string | null;
  /**
   * That conversation is out of the Studio — either archived off the bench
   * (closed_at, slice 4) or archived away (status, deleteDesign's fallback
   * for an ordered design).
   */
  isArchived: boolean;
};

/**
 * My Designs is a library of images, not of conversations (studio-plan,
 * "What My Designs becomes"). Every image the user owns, newest first — no
 * keep verb, per the plan's open question.
 *
 * One statement plus the ride-along sweep for the grid itself; a second,
 * batched statement for the backdrops of whichever images turned out to be
 * published. Never a query per image.
 *
 * Query core shared by the server-component render — auth lives at the
 * caller.
 */
export async function getUserImageLibrary(
  userId: string
): Promise<LibraryImage[]> {
  // The stale-job sweep that used to ride the /designs card query still rides
  // this one (durable-generation-job plan): its result is discarded, this
  // just clears any overdue row for this user the next time they open
  // /designs, with no new traffic. Narrowest scope for this call site — only
  // the cron sweeps scope: "all".
  const [rows] = await Promise.all([
    db
      .select({
        imageId: imageTable.id,
        imageUrl: imageTable.imageUrl,
        createdAt: imageTable.createdAt,
        // Publish state is the job-B visibility grant and stays on `listing`
        // (docs/composition-first-class-plan.md §1) — a row exists iff the
        // image is published.
        publishedAt: listingTable.publishedAt,
        sourceDesignId: imageTable.sourceDesignId,
        sourceClosedAt: designTable.closedAt,
        sourceStatus: designTable.status,
      })
      .from(imageTable)
      .leftJoin(listingTable, eq(listingTable.imageId, imageTable.id))
      .leftJoin(designTable, eq(designTable.id, imageTable.sourceDesignId))
      // Ownership is the only filter. The library is the whole record of what
      // the user has made, so a conversation being archived — off the bench
      // (closed_at) or away (status, which is what deleteDesign leaves behind
      // for an ordered design) — marks its images, it does not hide them.
      // Hiding an ordered design's artwork would take the reorder route with
      // it, since /d is how a design reaches /preview now.
      .where(eq(imageTable.ownerId, userId))
      // created_at is seconds-resolution, so same-second inserts need the
      // rowid tiebreak to order deterministically (getDesignSourceImages
      // convention, reversed — the library is newest first).
      .orderBy(desc(imageTable.createdAt), sql`image.rowid desc`),
    sweepStaleJobs({ scope: "user", userId }),
  ]);

  const publishedIds = rows
    .filter((row) => row.publishedAt !== null)
    .map((row) => row.imageId);
  const backdrops = await loadBackdrops(publishedIds);

  return rows.map((row) => ({
    imageId: row.imageId,
    imageUrl: row.imageUrl,
    createdAt: row.createdAt,
    isPublished: row.publishedAt !== null,
    backgroundColor: backdrops.get(row.imageId) ?? null,
    sourceDesignId: row.sourceDesignId,
    isArchived: row.sourceClosedAt !== null || row.sourceStatus === "archived",
  }));
}

/**
 * Pinned storefront backdrop per image. A job-A sellable field, so since
 * composition slice 2 it comes off the mirror `product` row, not
 * `listing.background_color` (that reader is gone from every sellable
 * surface, and the column goes with the composition plan's slice 4).
 *
 * Best-effort: if this query fails the grid renders the artwork on the
 * checkerboard rather than not rendering at all.
 */
async function loadBackdrops(
  imageIds: string[]
): Promise<Map<string, string | null>> {
  if (imageIds.length === 0) return new Map();
  try {
    const rows = await db
      .select({
        id: mirrorFrontImageId,
        backdropColor: productTable.backdropColor,
      })
      .from(productTable)
      .where(
        and(isPublishedShopMirror(), inArray(mirrorFrontImageId, imageIds))
      );
    return new Map(rows.map((r) => [r.id, r.backdropColor ?? null]));
  } catch (err) {
    console.error("getUserImageLibrary: backdrop lookup failed", err);
    return new Map();
  }
}
