/**
 * Composition read helpers (docs/composition-first-class-plan.md §5).
 *
 * The four "job A" sellable surfaces — the Shop feed, the image detail page,
 * the admin published grid and order-line titles — read their title /
 * description / backdrop / feed rank / listed-at from the image's `product`
 * composition. `image_publication` keeps job B (the image-visibility grant
 * read by the pure guards in design-publish.ts and their feeders); nothing in
 * this module touches that. Whether an image is published or hidden is read
 * from `image_publication` only (#289 item 4); the `product.status` mirror is
 * still written on publish, unpublish and hide, but no reader derives
 * visibility from it. `isPublishedShopMirror` and `listedMirrorPublishedAt`
 * remain for the Shop feed, which sells compositions rather than images.
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
 * `placements ->> '$.front'` (see the schema comment on `product` for why the
 * arrow form); the export name predates the column so call sites did not
 * churn.
 */
export const mirrorFrontImageId = productTable.frontImageId;

/**
 * Compositions whose image is currently published: `draft` is what unpublish
 * leaves behind, so it means "not published"; `listed` and `hidden` are both
 * published. For the composition's own fields (title, backdrop); whether the
 * image is published or hidden is `image_publication`'s to say.
 */
export function isPublishedShopMirror(): SQL {
  return ne(productTable.status, "draft");
}

/**
 * The publish-timestamp rule for readers of a composition's own timestamps.
 *
 * `listed_at` is set on every publish; the `created_at` fallback covers only a
 * hand-written row, so a listed composition with a null `listed_at` still
 * sorts in the Shop feed. The parity script fails on a null `listed_at` so
 * this never silently absorbs a real problem.
 */
function publishedAtOf(listedAt: Date | null, createdAt: Date): Date {
  return listedAt ?? createdAt;
}

/**
 * Same rule for readers whose query already excludes drafts (the feed), where the result is known to be non-null.
 */
export function listedMirrorPublishedAt(
  listedAt: Date | null,
  createdAt: Date
): Date {
  return publishedAtOf(listedAt, createdAt);
}
