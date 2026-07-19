"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  designImage as designImageTable,
  user as userTable,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { computePrice } from "@/lib/pricing";
import { DEFAULT_BLANK_ID } from "@/lib/blanks";
import { createStripeCheckoutForOrder } from "@/app/order/actions";
import { getPublishedFeed } from "@/lib/discover-feed";
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
  const rows = await db
    .select({
      imageId: designImageTable.id,
      title: designImageTable.title,
      publishedAt: designImageTable.publishedAt,
      isHidden: designImageTable.isHidden,
      designerName: userTable.name,
      forkedFromImageId: designTable.forkedFromImageId,
    })
    .from(designImageTable)
    .innerJoin(designTable, eq(designTable.id, designImageTable.designId))
    .innerJoin(userTable, eq(userTable.id, designTable.userId))
    .where(eq(designImageTable.id, imageId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    imageId: r.imageId,
    title: r.title,
    designerName: r.designerName,
    forkedFromImageId: r.forkedFromImageId,
    publishedAt: r.publishedAt,
    isHidden: r.isHidden,
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
      imageId: designImageTable.id,
      imageUrl: designImageTable.imageUrl,
      title: designImageTable.title,
      description: designImageTable.description,
      backgroundColor: designImageTable.backgroundColor,
      publishedAt: designImageTable.publishedAt,
      isHidden: designImageTable.isHidden,
      designerName: userTable.name,
      designerId: userTable.id,
      forkedFromImageId: designTable.forkedFromImageId,
    })
    .from(designImageTable)
    .innerJoin(designTable, eq(designTable.id, designImageTable.designId))
    .innerJoin(userTable, eq(userTable.id, designTable.userId))
    .where(eq(designImageTable.id, imageId))
    .limit(1);

  const r = rows[0];
  if (!r || !r.publishedAt || r.isHidden) return null;

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
}): Promise<{ url: string | null; needsAuth?: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  // Purchase point — guests (anonymous-plugin sessions) and the sessionless
  // must sign in to buy. The buy panel's "Sign in to buy" CTA is the primary
  // path; this is the server backstop.
  if (!session || isAnonymousUser(session.user)) {
    return { url: null, needsAuth: true };
  }

  const image = await db.query.designImage.findFirst({
    where: eq(designImageTable.id, params.imageId),
  });
  if (!image) throw new Error("Image not found");

  if (!canBuyPublishedImage(image)) {
    throw new Error("Image is not available to buy");
  }

  const resolvedProductId = params.productId ?? DEFAULT_BLANK_ID;
  const pricing = computePrice(0, resolvedProductId, params.size);

  return createStripeCheckoutForOrder({
    userId: session.user.id,
    designId: image.designId,
    productId: resolvedProductId,
    size: params.size,
    color: params.color,
    itemPrice: pricing.total,
    placements: { front: params.imageId },
    checkoutImageUrl: image.imageUrl,
    cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/d/${params.imageId}`,
  });
}
