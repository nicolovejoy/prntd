/**
 * Composition slice 2 read helpers (docs/composition-first-class-plan.md §5).
 *
 * The four "job A" sellable surfaces — the Shop feed, the image detail page,
 * the admin published grid and order-line titles — read their title /
 * description / backdrop / feed rank / listed-at from the image's mirror
 * `product` row instead of its `listing` row. `listing` keeps job B (the
 * image-visibility grant read by the pure guards in design-publish.ts and
 * their feeders); nothing in this module touches that.
 *
 * A mirror row is identified exactly as slice 1 writes it
 * (model-b-writes.ts `buildMirrorProductRow`, composition-backfill.ts):
 * `store_id IS NULL AND design_id IS NULL` and `placements` = `{front: <imageId>}`.
 * Slice 1 identified it by whole-JSON equality; the readers need to *join*
 * on the front slot, so they extract it with `json_extract` — same slot, an
 * expression a query can join and filter on.
 *
 * `design_id IS NULL` is load-bearing, not belt-and-braces: an organizer
 * product that has not been shelved in a store yet also has `store_id IS
 * NULL` (store-service.createProduct) and can be set to `status = "listed"`,
 * so filtering on store_id alone would leak organizer compositions into the
 * PRNTD Shop feed.
 */
import { and, isNull, ne, sql, type SQL } from "drizzle-orm";
import { product as productTable } from "@/lib/db/schema";

/**
 * SQL expression yielding a mirror product's front-placement image id.
 * Join/filter target for every read site.
 */
export const mirrorFrontImageId = sql<string>`json_extract(${productTable.placements}, '$.front')`;

/**
 * Rows that are PRNTD Shop mirror compositions, whatever their status
 * (draft included — unpublish leaves the row behind as a draft).
 */
export function isShopMirror(): SQL {
  return and(
    isNull(productTable.storeId),
    isNull(productTable.designId)
  ) as SQL;
}

/**
 * Shop mirrors whose image is currently published: `draft` is what unpublish
 * leaves behind, so it means "not published"; `listed` and `hidden` are both
 * published (hidden is admin moderation, which the admin grid still shows).
 */
export function isPublishedShopMirror(): SQL {
  return and(isShopMirror(), ne(productTable.status, "draft")) as SQL;
}

/** Mirror status → the boolean the pure guards and the admin grid expect. */
export function mirrorIsHidden(status: string | null): boolean {
  return status === "hidden";
}

/**
 * Mirror status + listedAt → the nullable `publishedAt` readers expect.
 * A draft mirror keeps its old listedAt, so status decides.
 */
export function mirrorPublishedAt(
  status: string | null,
  listedAt: Date | null
): Date | null {
  if (status === null || status === "draft") return null;
  return listedAt;
}
