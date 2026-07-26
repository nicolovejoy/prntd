"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  image as imageTable,
  listing as listingTable,
  user as userTable,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDesignImageWithOwner } from "@/lib/design-images";
import { computePrice } from "@/lib/pricing";
import { DEFAULT_BLANK_ID, multiPlacementEnabled } from "@/lib/blanks";
import { createStripeCheckoutForOrder } from "@/app/order/actions";
import { getPublishedFeed } from "@/lib/discover-feed";
import {
  assertUsableBackImage,
  getBuyPageBackSourceGroups,
  type BackSourceGroup,
} from "@/lib/back-sources";
import {
  canBuyPublishedImage,
  buildForkChain,
  type ForkChainEntry,
  type ForkChainRow,
} from "@/lib/design-publish";

export type PublishedImage = {
  imageId: string;
  imageUrl: string;
  title: string | null;
  description: string | null;
  /** Pinned storefront backdrop (a BACKGROUND_PALETTE color name); legacy null displays as White (#73). */
  backgroundColor: string | null;
  designerName: string;
  designerId: string;
  /** True when the feed viewer is this design's owner — render "by you". */
  isOwn: boolean;
  publishedAt: Date;
  /**
   * Walks the lineage from this image's parent up toward the root,
   * stopping at the first hop that isn't published + visible. Empty
   * for original work or when the immediate parent has been hidden.
   * Entries are immediate-parent-first.
   */
  forkChain: ForkChainEntry[];
};

/**
 * Public discover feed. Returns published, non-hidden images — admin-ranked
 * first, then newest first (see src/lib/discover-feed.ts). No auth required.
 */
export async function getDiscoverFeed(limit = 60): Promise<PublishedImage[]> {
  // Identify the viewer so we can tag their own designs "by you". Best-effort:
  // a signed-out visitor just sees every card attributed by maker name.
  let viewerId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    viewerId = session?.user.id ?? null;
  } catch {
    viewerId = null;
  }

  const rows = await getPublishedFeed(limit);

  return rows.map((r) => ({
    imageId: r.imageId,
    imageUrl: r.imageUrl,
    title: r.title,
    description: r.description,
    backgroundColor: r.backgroundColor,
    designerName: r.designerName,
    designerId: r.designerId,
    isOwn: viewerId !== null && r.designerId === viewerId,
    publishedAt: r.publishedAt,
    forkChain: [],
  }));
}

/**
 * Fetcher backing buildForkChain — one row per imageId, joining design
 * and user so we can render the chain without further round-trips.
 */
async function fetchForkChainRow(imageId: string): Promise<ForkChainRow | null> {
  // Lineage now lives on the image graph (image.seed_image_id), not on the
  // conversation. Publish state comes from the listing — a left join, so an
  // unpublished hop still returns a row and buildForkChain stops on it.
  const rows = await db
    .select({
      imageId: imageTable.id,
      title: listingTable.title,
      publishedAt: listingTable.publishedAt,
      isHidden: listingTable.isHidden,
      designerName: userTable.name,
      forkedFromImageId: imageTable.seedImageId,
    })
    .from(imageTable)
    .innerJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .leftJoin(listingTable, eq(listingTable.imageId, imageTable.id))
    .where(eq(imageTable.id, imageId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    imageId: r.imageId,
    title: r.title,
    designerName: r.designerName,
    forkedFromImageId: r.forkedFromImageId,
    publishedAt: r.publishedAt,
    isHidden: r.isHidden ?? false,
  };
}

/**
 * Public single-image page. Returns null on unpublished or hidden
 * images (the route 404s).
 */
export async function getPublishedImage(
  imageId: string
): Promise<PublishedImage | null> {
  const rows = await db
    .select({
      imageId: imageTable.id,
      imageUrl: imageTable.imageUrl,
      title: listingTable.title,
      description: listingTable.description,
      backgroundColor: listingTable.backgroundColor,
      publishedAt: listingTable.publishedAt,
      isHidden: listingTable.isHidden,
      designerName: userTable.name,
      designerId: userTable.id,
      forkedFromImageId: imageTable.seedImageId,
    })
    .from(listingTable)
    .innerJoin(imageTable, eq(imageTable.id, listingTable.imageId))
    .innerJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .where(eq(imageTable.id, imageId))
    .limit(1);

  const r = rows[0];
  if (!r || r.isHidden) return null;

  // Walk forkedFromImageId upward, stopping at the first invisible
  // parent so admin moderation also breaks the public chain.
  const forkChain = await buildForkChain(r.forkedFromImageId, fetchForkChainRow);

  let viewerId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    viewerId = session?.user.id ?? null;
  } catch {
    viewerId = null;
  }

  return {
    imageId: r.imageId,
    imageUrl: r.imageUrl,
    title: r.title,
    description: r.description,
    backgroundColor: r.backgroundColor,
    designerName: r.designerName,
    designerId: r.designerId,
    isOwn: viewerId !== null && r.designerId === viewerId,
    publishedAt: r.publishedAt,
    forkChain,
  };
}

/**
 * Source groups for the /d back-design picker. Same shape as /preview's
 * getBackDesignSources, scoped for a buyer who usually doesn't own the
 * image's source design: My Designs + Shop, with This design only for the
 * owner (getBuyPageBackSourceGroups). Empty when the flag is off or the
 * viewer isn't a signed-in, non-anonymous user — the buy page hides the
 * back affordance for both, this is the server backstop.
 */
export async function getBuyPageBackSources(
  imageId: string
): Promise<{ groups: BackSourceGroup[] }> {
  if (!multiPlacementEnabled()) return { groups: [] };

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAnonymousUser(session.user)) return { groups: [] };

  const image = await getDesignImageWithOwner(imageId);
  if (!image || !image.designId || !canBuyPublishedImage(image)) {
    return { groups: [] };
  }

  const groups = await getBuyPageBackSourceGroups({
    designId: image.designId,
    viewerId: session.user.id,
  });
  return { groups };
}

/**
 * Buy-existing path: a logged-in user purchases a published image from
 * `/d/[imageId]` without designing one. Account-gated by decision (orders
 * must tie to an account so they're trackable in /orders) — the auth check
 * and userId resolution are isolated here so a future guest swap is a few
 * lines.
 *
 * The order is pinned to the exact image bought (`placements.front =
 * imageId`) so the webhook prints that image regardless of later
 * regenerations of its source design. Price is `computePrice(0, …)` — the
 * buyer didn't incur generation cost; the designer's is internal-only and
 * never billed anyway. The order's designId is the image's source design,
 * NOT a new design — the buyer isn't creating one.
 */
export async function buyPublishedDesign(params: {
  imageId: string;
  productId?: string;
  size: string;
  color: string;
  /** Source design_image id to print on the back (#25). Honored only when
   * MULTI_PLACEMENT_ENABLED; ignored otherwise (defense in depth). */
  backImageId?: string;
}): Promise<{ url: string | null; needsAuth?: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  // Purchase point — guests (anonymous-plugin sessions) and the sessionless
  // must sign in to buy. The buy panel's "Sign in to buy" CTA is the primary
  // path; this is the server backstop.
  if (!session || isAnonymousUser(session.user)) {
    return { url: null, needsAuth: true };
  }

  const image = await getDesignImageWithOwner(params.imageId);
  if (!image || !image.designId) throw new Error("Image not found");

  if (!canBuyPublishedImage(image)) {
    throw new Error("Image is not available to buy");
  }

  // Note the order's designId is the SELLER's design here, so the guard's
  // thread argument gives a cross-owner buyer no extra reach (see
  // canUseAsPlacementSource) — the back image must be the buyer's own or
  // published.
  const backImageId = multiPlacementEnabled()
    ? params.backImageId ?? null
    : null;
  if (backImageId) {
    await assertUsableBackImage(backImageId, image.designId, session.user.id);
  }

  const resolvedProductId = params.productId ?? DEFAULT_BLANK_ID;
  const pricing = computePrice(0, resolvedProductId, params.size, {
    back: !!backImageId,
  });

  return createStripeCheckoutForOrder({
    userId: session.user.id,
    designId: image.designId,
    productId: resolvedProductId,
    size: params.size,
    color: params.color,
    itemPrice: pricing.total,
    placements: {
      front: params.imageId,
      ...(backImageId ? { back: backImageId } : {}),
    },
    checkoutImageUrl: image.imageUrl,
    cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/d/${params.imageId}`,
  });
}
