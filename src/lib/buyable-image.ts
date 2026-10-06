// Not a "use server" module on purpose: this is the one decision behind every
// image-detail-page buy surface (buyPublishedDesign, addToCart's image path,
// the back-source reads, the mockup actions), and it takes the viewer's id as
// an argument it trusts. Exporting it from a "use server" file would make it a
// publicly callable Server Action.
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getDesignImageWithOwner,
  type ImageWithOwner,
} from "@/lib/design-images";
import { canBuyImage, canBuyPublishedImage } from "@/lib/design-publish";

/** An image the viewer may order, and which ordering branch it takes. */
export type BuyableImage = {
  /** The `image` row, never a placement render. */
  image: ImageWithOwner;
  /** The conversation the order belongs to (`order.design_id`, NOT NULL). */
  designId: string;
  /**
   * Published and not hidden: the order is a Shop sale and records the image's
   * mirror composition (`order.store_product_id`), whoever buys it, its owner
   * included. False means the owner's own unpublished work, which is ordered
   * with no Shop composition.
   */
  published: boolean;
};

export type BuyableImageResult =
  | ({ ok: true } & BuyableImage)
  /** `not-found`: no such `image` row, a placement render, or an image with no
   * conversation id at all. `not-allowed`: the image exists but this viewer may
   * not order it. Callers choose their own wording for each. */
  | { ok: false; reason: "not-found" | "not-allowed" };

/**
 * Whether `userId` (null when signed out) may order `imageId` from its image
 * detail page, and through which branch. The one gate shared by every action
 * behind the page, so they cannot drift:
 *
 *  - The id must be an `image` row. A `placement_render` id resolves through
 *    `getDesignImageWithOwner` too (with its conversation's owner), but it is
 *    never a page image: the page itself 404s it.
 *  - `canBuyImage`: published and not hidden for anyone; otherwise only the
 *    image's owner, and never when admin-hidden.
 *  - Published: nothing more is asked, exactly as before this slice.
 *  - Unpublished: the image's conversation must still exist and belong to the
 *    buyer. `order.design_id` is NOT NULL and the mockup cache lives on the
 *    design row, so an image with no live conversation cannot be ordered, and
 *    an image whose conversation id names someone else's thread must not put
 *    their design on an order or write to their mockup cache. This is the
 *    `design.userId === session.user.id` check `/preview` made, so the image
 *    detail page is never a weaker way in than `/preview` was.
 */
export async function resolveBuyableImage(
  imageId: string,
  userId: string | null
): Promise<BuyableImageResult> {
  const image = await getDesignImageWithOwner(imageId);
  if (!image || image.kind !== "image" || !image.designId) {
    return { ok: false, reason: "not-found" };
  }

  if (
    !canBuyImage({
      image: { publishedAt: image.publishedAt, isHidden: image.isHidden },
      imageOwnerId: image.ownerId,
      userId,
    })
  ) {
    return { ok: false, reason: "not-allowed" };
  }

  if (canBuyPublishedImage(image)) {
    return { ok: true, image, designId: image.designId, published: true };
  }

  // Unpublished, so canBuyImage passed on ownership: userId is the owner.
  if (userId === null || userId === "") {
    return { ok: false, reason: "not-allowed" };
  }
  const [conversation] = await db
    .select({ userId: designTable.userId })
    .from(designTable)
    .where(eq(designTable.id, image.designId))
    .limit(1);
  if (!conversation || conversation.userId !== userId) {
    return { ok: false, reason: "not-allowed" };
  }
  return { ok: true, image, designId: image.designId, published: false };
}
