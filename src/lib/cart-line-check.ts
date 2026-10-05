// Not a "use server" module on purpose: it takes the user id as an argument it
// trusts (the same reason as src/lib/buyable-image.ts and order-checkout.ts).
import { db } from "@/lib/db";
import { design as designTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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
 *  - its design still exists;
 *  - every pinned placement passes `assertUsablePlacementImage` for this user;
 *  - and, with no front pinned (a legacy `/preview` line that prints the
 *    design's primary), the design is the user's own and its primary is not
 *    hidden. A line on someone else's design with no pins can't have come from
 *    `addToCart`, so it is refused.
 */
export async function cartLineStillValid(
  line: { designId: string; placements: Record<string, string> | null },
  userId: string
): Promise<boolean> {
  const [design] = await db
    .select({ userId: designTable.userId, primaryImageId: designTable.primaryImageId })
    .from(designTable)
    .where(eq(designTable.id, line.designId))
    .limit(1);
  if (!design) return false;

  const pins = Object.entries(line.placements ?? {});
  try {
    for (const [placement, imageId] of pins) {
      await assertUsablePlacementImage(
        imageId,
        line.designId,
        userId,
        placement === "front" ? "front" : "back"
      );
    }
    if (!line.placements?.front) {
      if (design.userId !== userId) return false;
      if (design.primaryImageId) await assertPrimaryNotHidden(design.primaryImageId);
    }
  } catch {
    return false;
  }
  return true;
}
