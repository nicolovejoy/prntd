// Not a "use server" module on purpose: it takes the user id as an argument it
// trusts (the same reason as src/lib/buyable-image.ts and order-checkout.ts).
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { productSupportsPlacement, resolveOrderVariant } from "@/lib/blanks";
import {
  assertPrimaryNotHidden,
  assertUsablePlacementImage,
} from "@/lib/back-sources";

/**
 * Whether a cart line would still be accepted if `userId` added it now
 * (`checkoutCart` and `getCart` use it). `addToCart` validates a line once, at
 * add time; an image can leave the Shop (the owner unpublishes it, an admin
 * hides it) while the line sits in a cart, and checkout used to pin whatever
 * the line named.
 *
 * The catalog can move under a line as well as the images: the product, size
 * and colour must still resolve to a fulfillable variant
 * (`resolveOrderVariant`) and a back needs a product that still has a back
 * print area, the same two checks `addToCart` makes.
 *
 * A cart line does not record which path added it (`/preview`'s `designId`
 * path or the image detail page's `frontImageId` path): it stores the design,
 * the product/size/colour and the pinned placements. Those are enough, because
 * the only things that can change after the add are the pinned images' state,
 * and each path guards exactly that with `assertUsablePlacementImage` (your own
 * non-hidden image, or a published, non-hidden one). The path-specific extras
 * can't drift: a Shop line's page image is one of the pins and fails the same
 * guard once unpublished or hidden; an owner's unpublished-image line needs
 * their own live conversation, which a cart pin keeps from being deleted.
 * So the line is valid when:
 *
 *  - its product, size and colour resolve and a back is still printable;
 *  - its design still exists;
 *  - every pinned placement passes `assertUsablePlacementImage` for this user;
 *  - and, with no front pinned (a legacy `/preview` line that prints the
 *    design's primary), the design is the user's own and its primary is not
 *    hidden. A line on someone else's design with no pins can't have come from
 *    `addToCart`, so it is refused.
 */
export async function cartLineStillValid(
  line: {
    designId: string;
    productId: string;
    size: string;
    color: string;
    placements: Record<string, string> | null;
  },
  userId: string
): Promise<boolean> {
  // The catalog checks `addToCart` makes (resolveOrderVariant, then the back
  // area): a line whose product, size or colour has left the catalog can't be
  // fulfilled, and a back on a product that lost its back print area would be
  // charged for and then dropped by fulfillment.
  let product;
  try {
    ({ product } = resolveOrderVariant({
      productId: line.productId,
      size: line.size,
      color: line.color,
    }));
  } catch {
    return false;
  }
  if (line.placements?.back && !productSupportsPlacement(product, "back")) {
    return false;
  }

  // The queries are independent, so they run together: the design row, every
  // pin's check, and (for a pinless line) nothing more. Roughly 1 query for the
  // design plus 1-2 per pin (the image row, the render fallback, one more per
  // render hop), and 1-2 for a pinless line's primary.
  const pins = Object.entries(line.placements ?? {});
  const pinChecks = pins.map(([placement, imageId]) =>
    assertUsablePlacementImage(
      imageId,
      line.designId,
      userId,
      placement === "front" ? "front" : "back"
    ).then(
      () => true,
      () => false
    )
  );
  const [design, ...pinResults] = await Promise.all([
    db
      .select({
        userId: designTable.userId,
        primaryImageId: designTable.primaryImageId,
      })
      .from(designTable)
      .where(eq(designTable.id, line.designId))
      .limit(1)
      .then((rows) => rows[0]),
    ...pinChecks,
  ]);
  // The foreign key (cart_item.design_id → design) means a line's design row
  // always exists, so this is unreachable today. It stays as the narrowing for
  // the property reads below and as a refusal (not a crash) if that ever
  // changes, e.g. a design deleted by a path that skips the cart-line check.
  if (!design) return false;
  if (pinResults.some((ok) => !ok)) return false;

  // No front pinned (a legacy /preview line prints the design's primary): the
  // design must be the user's own and its primary not hidden.
  if (!line.placements?.front) {
    if (design.userId !== userId) return false;
    if (design.primaryImageId) {
      try {
        await assertPrimaryNotHidden(design.primaryImageId);
      } catch {
        return false;
      }
    }
  }
  return true;
}
