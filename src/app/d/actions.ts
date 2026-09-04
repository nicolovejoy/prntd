"use server";

import { headers } from "next/headers";
import { auth, isAnonymousUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  design as designTable,
  image as imageTable,
  product as productTable,
  user as userTable,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  isPublishedShopMirror,
  mirrorFrontImageId,
  mirrorIsHidden,
  mirrorPublishedAt,
} from "@/lib/composition-reads";
import {
  getDesignImageWithOwner,
  getDesignSourceImages,
} from "@/lib/design-images";
import { computePrice } from "@/lib/pricing";
import { DEFAULT_BLANK_ID, multiPlacementEnabled } from "@/lib/blanks";
import { createStripeCheckoutForOrder } from "@/app/order/actions";
import { renderAndCacheMockup } from "@/lib/mockup-render";
import { getPublishedFeed } from "@/lib/discover-feed";
import {
  assertUsablePlacementImage,
  getBuyPageBackSourceGroups,
  type BackSourceGroup,
} from "@/lib/back-sources";
import {
  canBuyPublishedImage,
  canViewImagePage,
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
 * What `/d/[imageId]` renders. Same shape as a feed card plus the two things
 * only the page needs: nullable `publishedAt` (the page now also serves the
 * owner's unpublished images, #136 slice 1) and the conversation that
 * produced the image, for the owner's "View conversation" link.
 */
export type ImagePage = Omit<PublishedImage, "publishedAt"> & {
  publishedAt: Date | null;
  sourceDesignId: string | null;
  /**
   * The source conversation still exists AND is reachable. False for a legacy
   * image with no sourceDesignId and for one whose conversation has since been
   * deleted (the image survives a delete when an order, seed or cart pins it),
   * where offering "Open conversation" would lead nowhere.
   */
  hasSourceConversation: boolean;
  /**
   * The source conversation has left the Studio — `closed_at` (the sweep or an
   * explicit Close) or `status = 'archived'` (deleteDesign's fallback for an
   * ordered design). The owner's "Open conversation" undoes both on the way
   * through (slice 5).
   */
  sourceConversationArchived: boolean;
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
  // conversation. Publish state comes from the image's mirror product
  // (composition slice 2) — a left join, so an unpublished hop still returns
  // a row and buildForkChain stops on it.
  const rows = await db
    .select({
      imageId: imageTable.id,
      title: productTable.title,
      status: productTable.status,
      listedAt: productTable.listedAt,
      productCreatedAt: productTable.createdAt,
      designerName: userTable.name,
      forkedFromImageId: imageTable.seedImageId,
    })
    .from(imageTable)
    .innerJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .leftJoin(
      productTable,
      and(isPublishedShopMirror(), eq(mirrorFrontImageId, imageTable.id))
    )
    .where(eq(imageTable.id, imageId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    imageId: r.imageId,
    title: r.title,
    designerName: r.designerName,
    forkedFromImageId: r.forkedFromImageId,
    publishedAt: mirrorPublishedAt(r.status, r.listedAt, r.productCreatedAt),
    isHidden: mirrorIsHidden(r.status),
  };
}

/**
 * Single-image page data. Serves published images to everyone and the
 * owner's own unpublished images to the owner (#136 slice 1) — the mirror
 * product is a left join, so an image with no mirror row still returns.
 * Returns null when the viewer may not see it (canViewImagePage) and the
 * route 404s.
 *
 * Composition slice 2: the sellable fields (title / description / backdrop /
 * listedAt) and the hidden flag come off the image's mirror `product` row.
 */
export async function getImagePage(
  imageId: string
): Promise<ImagePage | null> {
  const rows = await db
    .select({
      imageId: imageTable.id,
      imageUrl: imageTable.imageUrl,
      title: productTable.title,
      description: productTable.description,
      backgroundColor: productTable.backdropColor,
      status: productTable.status,
      listedAt: productTable.listedAt,
      productCreatedAt: productTable.createdAt,
      designerName: userTable.name,
      designerId: userTable.id,
      forkedFromImageId: imageTable.seedImageId,
      sourceDesignId: imageTable.sourceDesignId,
      sourceDesignRowId: designTable.id,
      sourceClosedAt: designTable.closedAt,
      sourceStatus: designTable.status,
    })
    .from(imageTable)
    .innerJoin(userTable, eq(userTable.id, imageTable.ownerId))
    .leftJoin(
      productTable,
      and(isPublishedShopMirror(), eq(mirrorFrontImageId, imageTable.id))
    )
    // Left, not inner: legacy images carry no sourceDesignId, and the page
    // must still render them.
    .leftJoin(designTable, eq(designTable.id, imageTable.sourceDesignId))
    .where(eq(imageTable.id, imageId))
    .limit(1);

  const r = rows[0];
  if (!r) return null;

  const publishedAt = mirrorPublishedAt(r.status, r.listedAt, r.productCreatedAt);
  const isHidden = mirrorIsHidden(r.status);

  let viewerId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    viewerId = session?.user.id ?? null;
  } catch {
    viewerId = null;
  }

  const isOwn = viewerId !== null && r.designerId === viewerId;
  if (
    !canViewImagePage({
      image: { publishedAt, isHidden },
      imageOwnerId: r.designerId,
      userId: viewerId,
    })
  ) {
    return null;
  }

  // Walk forkedFromImageId upward, stopping at the first invisible
  // parent so admin moderation also breaks the public chain.
  const forkChain = await buildForkChain(r.forkedFromImageId, fetchForkChainRow);

  return {
    imageId: r.imageId,
    imageUrl: r.imageUrl,
    title: r.title,
    description: r.description,
    backgroundColor: r.backgroundColor,
    designerName: r.designerName,
    designerId: r.designerId,
    isOwn,
    publishedAt,
    sourceDesignId: r.sourceDesignId,
    hasSourceConversation: r.sourceDesignRowId !== null,
    sourceConversationArchived:
      r.sourceClosedAt !== null || r.sourceStatus === "archived",
    forkChain,
  };
}

export type SiblingImage = {
  imageId: string;
  imageUrl: string;
  isPrimary: boolean;
};

/**
 * The other images from the conversation that produced `imageId` (#136
 * slice 3): the variant history, so a non-primary generation is one tap away
 * from the image page instead of buried in the chat thread.
 *
 * Owner-only — a conversation's unpublished variants aren't public, and the
 * caller renders a "Use this one" action alongside. Returns the current image
 * too (flagged `isPrimary` when it's the design's primary) so the caller can
 * decide whether that action applies; callers filter it out of the strip.
 */
export async function getConversationImages(
  designId: string
): Promise<{ images: SiblingImage[]; primaryImageId: string | null }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { images: [], primaryImageId: null };

  const found = await db.query.design.findFirst({
    where: eq(designTable.id, designId),
    columns: { userId: true, primaryImageId: true },
  });
  if (!found || found.userId !== session.user.id) {
    return { images: [], primaryImageId: null };
  }

  // Seeds included: a fresh-start thread's anchor is part of its history and
  // is a legitimate primary (startConversationFromImage already sets it).
  const sources = await getDesignSourceImages(designId, { includeSeeds: true });
  return {
    images: sources.map((s) => ({
      imageId: s.id,
      imageUrl: s.imageUrl,
      isPrimary: s.id === found.primaryImageId,
    })),
    primaryImageId: found.primaryImageId,
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
 * Front-placement Printful mockup for the image detail page's Order-expand
 * hero (#135 slice 1). Visibility-gated like the page itself
 * (`canViewImagePage`: published && !hidden, or the owner) — deliberately
 * NOT ownership-gated, unlike `generateMockup` (`/preview`), because any
 * visitor who can see the buy page must be able to see the mockup.
 *
 * `sourceImageId` is always `imageId` itself: the order pins
 * `placements.front = imageId` (see `buyPublishedDesign` below), which may
 * not be the design's primary image, so the mockup has to render the LISTED
 * image, not whatever the design currently displays. Scale is fixed at 1.0 —
 * there's no scale control on this page. Cache reuse (and the render body
 * itself) is shared with `generateMockup` via `renderAndCacheMockup`.
 */
export async function getListingMockup(params: {
  imageId: string;
  productId: string;
  colorName: string;
}): Promise<{ mockupUrl: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  const viewerId = session?.user.id ?? null;

  const image = await getDesignImageWithOwner(params.imageId);
  if (!image || !image.designId) throw new Error("Image not found");

  if (
    !canViewImagePage({
      image: { publishedAt: image.publishedAt, isHidden: image.isHidden },
      imageOwnerId: image.ownerId,
      userId: viewerId,
    })
  ) {
    throw new Error("Unauthorized");
  }

  return renderAndCacheMockup({
    designId: image.designId,
    productId: params.productId,
    colorName: params.colorName,
    scale: 1.0,
    placementId: "front",
    sourceImageId: params.imageId,
    userId: viewerId,
  });
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
    await assertUsablePlacementImage(backImageId, image.designId, session.user.id);
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

