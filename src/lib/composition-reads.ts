/**
 * Composition read helpers (docs/composition-first-class-plan.md §5).
 *
 * The four "job A" sellable surfaces — the Shop feed, the image detail page,
 * the admin published grid and order-line titles — read their title /
 * description / backdrop / feed rank / listed-at from the image's `product`
 * composition. `image_publication` keeps job B (the image-visibility grant
 * read by the pure guards in design-publish.ts and their feeders); nothing in
 * this module touches that.
 *
 * Since composition slice 5 every `product` row IS a Shop composition — the
 * organizer population (`design_id` / `store_id` set) went with the
 * storefronts (#191), so there is no "is this a mirror?" predicate any more.
 * A composition is found by its front placement slot, which the schema
 * exposes as the generated column `product.front_image_id` (unique, so one
 * composition per front image is DB-enforced).
 */
import { ne, type SQL } from "drizzle-orm";
import { product as productTable } from "@/lib/db/schema";

/**
 * A composition's front-placement image id — the join/filter target for
 * every read site. The generated column `front_image_id` over
 * `json_extract(placements, '$.front')`; the export name predates the column
 * so call sites did not churn.
 */
export const mirrorFrontImageId = productTable.frontImageId;

/**
 * Compositions whose image is currently published: `draft` is what unpublish
 * leaves behind, so it means "not published"; `listed` and `hidden` are both
 * published (hidden is admin moderation, which the admin grid still shows).
 */
export function isPublishedShopMirror(): SQL {
  return ne(productTable.status, "draft");
}

/** Mirror status → the boolean the pure guards and the admin grid expect. */
export function mirrorIsHidden(status: string | null): boolean {
  return status === "hidden";
}

/**
 * The one publish-timestamp rule, so every reader agrees on it.
 *
 * `listed_at` is set on every publish; the `created_at` fallback covers only a
 * hand-written row, and exists so a published mirror with a null `listed_at`
 * can't be visible on one surface and 404 on another. The parity script fails
 * on a null `listed_at` so this never silently absorbs a real problem.
 */
function publishedAtOf(listedAt: Date | null, createdAt: Date): Date {
  return listedAt ?? createdAt;
}

/**
 * Mirror status + timestamps → the nullable `publishedAt` readers expect.
 * A draft mirror keeps its old listedAt, so status decides; an absent mirror
 * (left join miss, status null) is simply not published.
 */
export function mirrorPublishedAt(
  status: string | null,
  listedAt: Date | null,
  createdAt: Date | null
): Date | null {
  if (status === null || status === "draft" || createdAt === null) return null;
  return publishedAtOf(listedAt, createdAt);
}

/**
 * Same rule for readers whose query already excludes drafts (the feed, the
 * admin grid), where the result is known to be non-null.
 */
export function listedMirrorPublishedAt(
  listedAt: Date | null,
  createdAt: Date
): Date {
  return publishedAtOf(listedAt, createdAt);
}
