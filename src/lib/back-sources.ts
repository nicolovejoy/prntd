/**
 * Back-design source groups for the /preview picker (#72).
 *
 * The back of a shirt can print any of three image origins:
 *  - This design: the current thread's source images (the original picker).
 *  - My Designs: the display (primary) image of the user's other designs.
 *  - Shop: published, not-hidden images — the discover-feed surface.
 *
 * Mirror of `canUseAsPlacementSource` (design-publish.ts): everything this
 * returns passes that guard, and the guard rejects anything outside these
 * groups at the checkout choke points.
 */
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
} from "@/lib/db/schema";
import { eq, and, ne, desc, inArray, isNotNull } from "drizzle-orm";
import {
  getDesignSourceImages,
  getDesignImageWithOwner,
} from "@/lib/design-images";
import {
  dedupeFeedByDesign,
  canUseAsPlacementSource,
} from "@/lib/design-publish";

/**
 * Validate a back-placement image id before it can reach an order (#72).
 * Allowed origins mirror the picker groups below: the order's own design
 * thread, a design the buyer owns, or a published + not-hidden Shop image.
 * Throws on anything else — called at the checkout choke points
 * (createCheckoutSession, addToCart) so a forged id can't get a private
 * image printed.
 */
export async function assertUsableBackImage(
  backImageId: string,
  designId: string,
  userId: string
): Promise<void> {
  const image = await getDesignImageWithOwner(backImageId);
  if (
    !image ||
    !canUseAsPlacementSource({
      image,
      imageOwnerId: image.ownerId,
      orderDesignId: designId,
      userId,
    })
  ) {
    throw new Error("Back image is not available");
  }
}

export type BackSourceImage = {
  id: string;
  imageUrl: string;
};

export type BackSourceGroup = {
  id: "this-design" | "my-designs" | "shop";
  label: string;
  images: BackSourceImage[];
};

const GROUP_LIMIT = 24;

/**
 * Assemble the picker's groups. `userId` is the design owner's id for the
 * My Designs group — pass null for anonymous guests, who get only
 * This design + Shop. Empty groups are omitted.
 */
export async function getBackSourceGroups(params: {
  designId: string;
  userId: string | null;
}): Promise<BackSourceGroup[]> {
  const [thisDesign, myDesigns, shop] = await Promise.all([
    getDesignSourceImages(params.designId),
    params.userId
      ? getOtherDesignPrimaries(params.userId, params.designId)
      : Promise.resolve([]),
    getShopImages(params.designId),
  ]);

  const groups: BackSourceGroup[] = [];
  if (thisDesign.length > 0) {
    groups.push({
      id: "this-design",
      label: "This design",
      images: thisDesign.map((s) => ({ id: s.id, imageUrl: s.imageUrl })),
    });
  }
  if (myDesigns.length > 0) {
    groups.push({ id: "my-designs", label: "My designs", images: myDesigns });
  }
  if (shop.length > 0) {
    groups.push({ id: "shop", label: "Shop", images: shop });
  }
  return groups;
}

/**
 * Display images of the user's other designs: each design's primary image,
 * most recently touched design first. Designs without a primary (never
 * produced a source image) are skipped.
 */
async function getOtherDesignPrimaries(
  userId: string,
  excludeDesignId: string
): Promise<BackSourceImage[]> {
  const designs = await db
    .select({
      id: designTable.id,
      primaryImageId: designTable.primaryImageId,
    })
    .from(designTable)
    .where(
      and(
        eq(designTable.userId, userId),
        ne(designTable.id, excludeDesignId),
        isNotNull(designTable.primaryImageId)
      )
    )
    .orderBy(desc(designTable.updatedAt))
    .limit(GROUP_LIMIT);

  const primaryIds = designs
    .map((d) => d.primaryImageId)
    .filter((v): v is string => Boolean(v));
  if (primaryIds.length === 0) return [];

  const imageRows = await db
    .select({ id: designImageTable.id, imageUrl: designImageTable.imageUrl })
    .from(designImageTable)
    .where(inArray(designImageTable.id, primaryIds));
  const byId = new Map(imageRows.map((r) => [r.id, r.imageUrl]));

  // Preserve the designs' recency order; drop dangling primary pointers.
  const out: BackSourceImage[] = [];
  for (const d of designs) {
    const url = d.primaryImageId ? byId.get(d.primaryImageId) : undefined;
    if (d.primaryImageId && url) out.push({ id: d.primaryImageId, imageUrl: url });
  }
  return out;
}

/**
 * Published, not-hidden images — the getDiscoverFeed surface, collapsed to
 * one card per design (dedupeFeedByDesign), newest published first. The
 * current design's own published images are excluded: they already appear
 * under This design.
 */
async function getShopImages(
  excludeDesignId: string
): Promise<BackSourceImage[]> {
  const rows = await db
    .select({
      id: designImageTable.id,
      designId: designImageTable.designId,
      imageUrl: designImageTable.imageUrl,
      publishedAt: designImageTable.publishedAt,
    })
    .from(designImageTable)
    .where(
      and(
        isNotNull(designImageTable.publishedAt),
        eq(designImageTable.isHidden, false),
        ne(designImageTable.designId, excludeDesignId)
      )
    )
    .orderBy(desc(designImageTable.publishedAt))
    .limit(GROUP_LIMIT * 4);

  return dedupeFeedByDesign(rows.map((r) => ({ ...r, publishedAt: r.publishedAt! })))
    .slice(0, GROUP_LIMIT)
    .map((r) => ({ id: r.id, imageUrl: r.imageUrl }));
}
