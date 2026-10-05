/**
 * Back-design source groups for the /preview picker (#72) and the /d buy
 * page (getBuyPageBackSourceGroups).
 *
 * The back of a shirt can print any of three image origins:
 *  - This design: the current thread's source images (the original picker).
 *  - My Designs: the display (primary) image of the user's other designs.
 *  - Shop: published, not-hidden images — the discover-feed surface.
 * An admin-hidden image is in none of them: nobody may print one.
 *
 * Mirror of `canUseAsPlacementSource` (design-publish.ts): everything this
 * returns passes that guard, and the guard rejects anything outside these
 * groups at the checkout choke points.
 */
import { db } from "@/lib/db";
import {
  design as designTable,
  image as imageTable,
  listing as listingTable,
} from "@/lib/db/schema";
import { eq, and, ne, desc, isNotNull, inArray } from "drizzle-orm";
import {
  getDesignSourceImages,
  getDesignImageWithOwner,
  resolveImagesByIds,
} from "@/lib/design-images";
import {
  dedupeFeedByDesign,
  canUseAsPlacementSource,
} from "@/lib/design-publish";

/**
 * Validate a placement-source image id before it can reach an order (#72).
 * Allowed origins mirror the picker groups below: a design the buyer owns
 * (which covers the order's own thread on /preview and /order, where design
 * ownership is checked first) or a published + not-hidden Shop image.
 * Throws on anything else — called at the checkout choke points
 * (createCheckoutSession, addToCart, buyPublishedDesign) so a forged id
 * can't get a private image printed. On a Shop buy of a published image
 * `designId` is the SELLER's design, and on the owner's own unpublished image
 * their own; the guard deliberately gives either no weight (see
 * canUseAsPlacementSource).
 *
 * Placement-agnostic on purpose (#138): the front is a picked image id too
 * once the buy screen lets you change it, and it must clear exactly the same
 * bar as the back — a front pin never grants reach a back pin didn't already
 * have. The `placement` label only shapes the error message.
 */
export async function assertUsablePlacementImage(
  imageId: string,
  designId: string,
  userId: string,
  placement: "front" | "back" = "back"
): Promise<void> {
  const image = await getDesignImageWithOwner(imageId);
  if (
    !image ||
    !canUseAsPlacementSource({
      image,
      imageOwnerId: image.ownerId,
      orderDesignId: designId,
      userId,
    })
  ) {
    throw new Error(
      `${placement === "front" ? "Front" : "Back"} image is not available`
    );
  }
}

/**
 * Refuse an image the order would pin as its front WITHOUT a pick: the
 * design's current primary, when the caller sends no `front`. A pick is held
 * to `assertUsablePlacementImage`; the implicit primary used to be trusted
 * outright, which let an admin-hidden primary print. Only a hidden primary is
 * refused here (a primary that no longer resolves keeps its old behaviour:
 * the order pins the id and fulfillment falls back to the design's display
 * image).
 */
export async function assertPrimaryNotHidden(imageId: string): Promise<void> {
  const image = await getDesignImageWithOwner(imageId);
  if (image?.isHidden) throw new Error("Front image is not available");
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
    getDesignSourceImages(params.designId, { excludeHidden: true }),
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
 * Picker groups for the image detail page's buy panel (/d/[imageId]). On a
 * published image the buyer usually does NOT own the image's source design, so
 * the groups differ from /preview's; on the owner's own unpublished image they
 * do own it and get /preview's groups:
 *
 *  - This design appears only when the viewer owns the source design — a
 *    cross-owner buyer must never see the seller's private thread images.
 *  - My Designs: the viewer's own designs' primary images.
 *  - Shop: published, not-hidden images. For a non-owner the source design
 *    is NOT excluded here — its published images (including the one being
 *    bought) are legitimate back choices and This design won't list them.
 *
 * `viewerId` is a signed-in, non-anonymous user (the image detail page's
 * purchase gate); the action returns no groups for anyone else.
 */
export async function getBuyPageBackSourceGroups(params: {
  /** The published image's source design. */
  designId: string;
  viewerId: string;
}): Promise<BackSourceGroup[]> {
  const [design] = await db
    .select({ userId: designTable.userId })
    .from(designTable)
    .where(eq(designTable.id, params.designId))
    .limit(1);
  if (!design) return [];

  if (design.userId === params.viewerId) {
    return getBackSourceGroups({
      designId: params.designId,
      userId: params.viewerId,
    });
  }

  const [myDesigns, shop] = await Promise.all([
    getOtherDesignPrimaries(params.viewerId, params.designId),
    getShopImages(null),
  ]);

  const groups: BackSourceGroup[] = [];
  if (myDesigns.length > 0) {
    groups.push({ id: "my-designs", label: "My designs", images: myDesigns });
  }
  if (shop.length > 0) {
    groups.push({ id: "shop", label: "Shop", images: shop });
  }
  return groups;
}

/** The subset of `ids` an admin has hidden (`listing.is_hidden`). */
async function hiddenImageIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ imageId: listingTable.imageId })
    .from(listingTable)
    .where(and(inArray(listingTable.imageId, ids), eq(listingTable.isHidden, true)));
  return new Set(rows.map((r) => r.imageId));
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

  const [byId, hidden] = await Promise.all([
    resolveImagesByIds(primaryIds),
    hiddenImageIds(primaryIds),
  ]);

  // Preserve the designs' recency order; drop dangling primary pointers and
  // admin-hidden images (nobody may print those).
  const out: BackSourceImage[] = [];
  for (const d of designs) {
    if (d.primaryImageId && hidden.has(d.primaryImageId)) continue;
    const url = d.primaryImageId ? byId.get(d.primaryImageId)?.imageUrl : undefined;
    if (d.primaryImageId && url) out.push({ id: d.primaryImageId, imageUrl: url });
  }
  return out;
}

/**
 * Published, not-hidden images — the getDiscoverFeed surface, collapsed to
 * one card per design (dedupeFeedByDesign), newest published first. Pass
 * `excludeDesignId` when the caller renders a This-design group (those
 * published images already appear there); null keeps every design in — the
 * /d cross-owner case, where the source design's published images are only
 * reachable through Shop.
 */
async function getShopImages(
  excludeDesignId: string | null
): Promise<BackSourceImage[]> {
  const rows = await db
    .select({
      id: imageTable.id,
      designId: imageTable.sourceDesignId,
      imageUrl: imageTable.imageUrl,
      publishedAt: listingTable.publishedAt,
    })
    .from(listingTable)
    .innerJoin(imageTable, eq(imageTable.id, listingTable.imageId))
    .where(
      and(
        eq(listingTable.isHidden, false),
        ...(excludeDesignId
          ? [ne(imageTable.sourceDesignId, excludeDesignId)]
          : [])
      )
    )
    .orderBy(desc(listingTable.publishedAt))
    .limit(GROUP_LIMIT * 4);

  // A listing row exists iff the image is published, so the old
  // published_at IS NOT NULL filter is the join itself. An image with no
  // source conversation is its own dedupe group.
  return dedupeFeedByDesign(
    rows.map((r) => ({ ...r, designId: r.designId ?? r.id }))
  )
    .slice(0, GROUP_LIMIT)
    .map((r) => ({ id: r.id, imageUrl: r.imageUrl }));
}
